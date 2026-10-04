(function () {
  'use strict';

  var memoryStore = Object.create(null);

  function canUseLocalStorage() {
    try {
      var testKey = '__sql_storage_probe__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getStorage() {
    return canUseLocalStorage() ? window.localStorage : null;
  }

  function normalizeValue(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return null;
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function parseValue(rawValue, fallbackValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return fallbackValue;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return rawValue;
    }
  }

  function readKey(key, fallbackValue) {
    var storage = getStorage();

    if (storage) {
      var stored = storage.getItem(key);
      if (stored !== null) return parseValue(stored, fallbackValue);
    }

    if (Object.prototype.hasOwnProperty.call(memoryStore, key)) {
      return memoryStore[key];
    }

    return fallbackValue;
  }

  function writeKey(key, value) {
    var storage = getStorage();
    var serialized = normalizeValue(value);
    memoryStore[key] = serialized;

    if (storage) {
      storage.setItem(key, serialized === null ? '' : serialized);
    }

    return value;
  }

  function deleteKey(key) {
    var storage = getStorage();
    delete memoryStore[key];
    if (storage && storage.getItem(key) !== null) storage.removeItem(key);
  }

  function keyList() {
    var storage = getStorage();
    var keys = [];

    if (storage) {
      for (var i = 0; i < storage.length; i += 1) {
        var key = storage.key(i);
        if (key) keys.push(key);
      }
    }

    Object.keys(memoryStore).forEach(function (key) {
      if (keys.indexOf(key) === -1) keys.push(key);
    });

    return keys;
  }

  async function sqlStorageGet(key, fallbackValue) {
    return readKey(key, fallbackValue);
  }

  async function sqlStorageSet(key, value) {
    return writeKey(key, value);
  }

  async function sqlStorageDelete(key) {
    deleteKey(key);
    return true;
  }

  async function sqlStorageClear() {
    var storage = getStorage();
    Object.keys(memoryStore).forEach(function (key) { delete memoryStore[key]; });
    if (storage) storage.clear();
    return true;
  }

  window.sqlStorage = {
    get: sqlStorageGet,
    set: sqlStorageSet,
    delete: sqlStorageDelete,
    clear: sqlStorageClear,
    keys: keyList,
    read: readKey,
    write: writeKey,
    remove: deleteKey,
  };

  window.sqlStorageGet = sqlStorageGet;
  window.sqlStorageSet = sqlStorageSet;
  window.sqlStorageDelete = sqlStorageDelete;
  window.sqlStorageClear = sqlStorageClear;
  window.sqlStorageKeys = keyList;
})();
