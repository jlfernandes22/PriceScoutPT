import contextlib
import io
import unittest

from remote_job import run_remote_job

JOB = 'b1a35d8f-0766-4bcd-bb97-1937221d451b'


class Response:
    def __init__(self, status, body):
        self.status_code, self.body = status, body

    def json(self):
        return self.body


class Session:
    def __init__(self, *responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return next(self.responses)


class RemoteJobTests(unittest.TestCase):
    def run_job(self, session, **kwargs):
        return run_remote_job('https://example.test', 'private-key', ['Froiz'],
                              session=session, sleep=lambda _: None, **kwargs)

    def test_waits_for_completion_and_redacts_logs(self):
        session = Session(Response(202, {'job_id': JOB}),
                          Response(200, {'scrapers': ['Froiz'], 'status': 'running'}),
                          Response(200, {'scrapers': ['Froiz'], 'status': 'completed',
                                         'exit_code': 0, 'log_tail': ['private-key']}))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.run_job(session)
        self.assertIn('[redacted]', output.getvalue())
        self.assertNotIn('private-key', output.getvalue())
        self.assertEqual(session.calls[0][1]['json']['details_limit'], 100)
        self.assertTrue(all(not call[1]['allow_redirects'] for call in session.calls))

    def test_redirect_does_not_forward_credentials(self):
        session = Session(Response(302, {}))
        with self.assertRaisesRegex(RuntimeError, 'redirected'):
            self.run_job(session)
        self.assertEqual(len(session.calls), 1)

    def test_conflict_only_joins_matching_collectors(self):
        session = Session(Response(409, {'running_job_id': JOB}),
                          Response(200, {'scrapers': ['Aldi'], 'status': 'running'}))
        with self.assertRaisesRegex(RuntimeError, 'different collectors'):
            self.run_job(session)

    def test_nonzero_exit_is_failure(self):
        session = Session(Response(202, {'job_id': JOB}),
                          Response(200, {'scrapers': ['Froiz'], 'status': 'completed', 'exit_code': 1}))
        with self.assertRaisesRegex(RuntimeError, 'failed'):
            self.run_job(session)

    def test_lost_status_never_launches_duplicate(self):
        session = Session(Response(202, {'job_id': JOB}), Response(404, {}))
        with self.assertRaisesRegex(RuntimeError, 'duplicate'):
            self.run_job(session)
        self.assertEqual(sum(call[0][0] == 'POST' for call in session.calls), 1)

    def test_invalid_id_cannot_change_destination(self):
        session = Session(Response(202, {'job_id': 'https://other.test'}))
        with self.assertRaisesRegex(RuntimeError, 'invalid'):
            self.run_job(session)
        self.assertEqual(len(session.calls), 1)

    def test_deadline_is_bounded(self):
        clock = iter([0, 2])
        with self.assertRaisesRegex(RuntimeError, 'deadline'):
            self.run_job(Session(Response(202, {'job_id': JOB})), timeout=1,
                         monotonic=lambda: next(clock))


if __name__ == '__main__':
    unittest.main()
