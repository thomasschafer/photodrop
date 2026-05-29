import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

const localStorageData = new Map<string, string>();

Object.defineProperties(Storage.prototype, {
  getItem: {
    configurable: true,
    writable: true,
    value(key: string): string | null {
      return localStorageData.get(String(key)) ?? null;
    },
  },
  setItem: {
    configurable: true,
    writable: true,
    value(key: string, value: string): void {
      localStorageData.set(String(key), String(value));
    },
  },
  removeItem: {
    configurable: true,
    writable: true,
    value(key: string): void {
      localStorageData.delete(String(key));
    },
  },
  clear: {
    configurable: true,
    writable: true,
    value(): void {
      localStorageData.clear();
    },
  },
  key: {
    configurable: true,
    writable: true,
    value(index: number): string | null {
      return Array.from(localStorageData.keys())[index] ?? null;
    },
  },
});

const testLocalStorage = Object.create(Storage.prototype) as Storage;

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
});

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
});

beforeEach(() => {
  localStorageData.clear();
});
