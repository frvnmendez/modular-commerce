'use client';
import { createContext, useContext } from 'react';

/**
 * Prefijo de los enlaces del escaparate: «/tienda/<slug>» o «» cuando la tienda se ve en su subdominio.
 * Lo calcula el layout (servidor) a partir de la marca que pone proxy.ts.
 */
const StoreBase = createContext('');
export const StoreBaseProvider = StoreBase.Provider;
export const useStoreBase = () => useContext(StoreBase);
