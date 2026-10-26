'use strict';

function createResultCache() {
  let cached = null;
  return {
    get() { return cached; },
    set(value) {
      cached = { value, at: new Date().toISOString() };
      return cached;
    },
    clear() { cached = null; },
  };
}

module.exports = { createResultCache };
