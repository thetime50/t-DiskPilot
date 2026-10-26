'use strict';

/** In-memory result cache, optionally keyed (e.g. by drive letter). */
function createResultCache() {
  const map = new Map();
  return {
    get(key = '_') {
      return map.get(String(key)) || null;
    },
    set(key, value) {
      // set(value) legacy → key '_'
      if (arguments.length === 1) {
        value = key;
        key = '_';
      }
      const entry = { value, at: new Date().toISOString() };
      map.set(String(key), entry);
      return entry;
    },
    clear(key) {
      if (key == null || key === '') map.clear();
      else map.delete(String(key));
    },
  };
}

module.exports = { createResultCache };