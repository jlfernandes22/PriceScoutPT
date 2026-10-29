import { useEffect, useState } from 'react';
import { database } from '../model';

// Product Models mutate in place. Comparisons must observe catalogue changes,
// rather than depending on a selected Model or shopping-list array identity.
export function useProductCatalogRevision(enabled = true) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const unsubscribe = database.collections.get('products').experimentalSubscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setRevision((value) => value + 1), 200);
    });
    const validityTimer = setInterval(() => setRevision((value) => value + 1), 60000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(validityTimer);
    };
  }, [enabled]);
  return revision;
}
