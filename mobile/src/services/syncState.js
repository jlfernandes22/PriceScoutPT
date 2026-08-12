// Estado global de sincronização: qualquer sync (arranque, pull, botão)
// coloca a app em modo "a carregar" — a lista não é mostrada enquanto
// o catálogo está a ser atualizado.
import React, { createContext, useContext, useState, useCallback } from 'react';

const SyncStateContext = createContext({
  isSyncing: false,
  setSyncState: () => {},
});

export const SyncStateProvider = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const setSyncState = useCallback((value) => setIsSyncing(value), []);
  return (
    <SyncStateContext.Provider value={{ isSyncing, setSyncState }}>
      {children}
    </SyncStateContext.Provider>
  );
};

export const useSyncState = () => useContext(SyncStateContext);
