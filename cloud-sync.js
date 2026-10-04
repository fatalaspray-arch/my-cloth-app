(function () {
  'use strict';

  const cdnUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  const versions = Object.create(null);
  const conflicts = new Set();
  const queues = Object.create(null);
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  const nativeClear = Storage.prototype.clear;
  const lastSyncedValues = Object.create(null);
  let clientPromise;
  let isHydrating = false;

  let currentProfile = null;

  function getModuleForKey(key) {
    if (key === 'dit_stores_data_v33' || key === 'dit_stores_data_v32' ||
        key === 'dit_departments_v1' ||
        /^safeKeeping(?:Items|Loans)(?:_|$)/.test(key)) return 'inventories';
    if (/^military_clothing_/.test(key) || key === 'military_saved_forms_v3') return 'clothing';
    if (key === 'dit_personnel_data') return 'personnel';
    if (key === 'dit_jobs_data' || key === 'ditJobCounter') return 'jobscard';
    if (/^payStore\./.test(key)) return 'payStores';
    if (key === 'dit_activity_log_v1') return 'activity';
    return null;
  }

  function canUseModule(moduleKey, permission) {
    if (!currentProfile) return false;
    if (currentProfile.role === 'Admin') return true;
    if (moduleKey === 'activity') {
      return Object.keys(currentProfile.modules || {}).some(function (key) {
        const grants = currentProfile.modules[key] || {};
        return permission === 'view'
          ? Boolean(grants.view || grants.add || grants.edit || grants.delete)
          : Boolean(grants.add || grants.edit || grants.delete);
      });
    }
    const grants = currentProfile.modules && currentProfile.modules[moduleKey] || {};
    return permission === 'view'
      ? Boolean(grants.view || grants.add || grants.edit || grants.delete)
      : Boolean(grants.add || grants.edit || grants.delete);
  }

  function canUseDepartment(department, permission) {
    if (!currentProfile || !department) return false;
    if (currentProfile.role === 'Admin') return true;
    const grants = currentProfile.departmentPrivileges && currentProfile.departmentPrivileges[department] || {};
    return permission === 'view'
      ? Boolean(grants.view || grants.add || grants.edit || grants.delete)
      : Boolean(grants.add || grants.edit || grants.delete);
  }

  function authorizedDepartments(permission) {
    if (!currentProfile) return [];
    if (currentProfile.role === 'Admin') {
      const stored = window.localStorage.getItem('dit_departments_v1');
      try { return stored ? JSON.parse(stored) : ['DIT']; } catch (error) { return ['DIT']; }
    }
    return Object.keys(currentProfile.departmentPrivileges || {}).filter(function (department) {
      return canUseDepartment(department, permission);
    });
  }

  function deptRecordKey(key, department) {
    return 'dept:' + encodeURIComponent(department) + ':' + key;
  }

  function parseDeptRecordKey(key) {
    const match = String(key).match(/^dept:([^:]+):(dit_stores_data_v(?:32|33))$/);
    if (!match) return null;
    return { department: decodeURIComponent(match[1]), localKey: match[2] };
  }

  function parseStoredValue(value) {
    try { return JSON.parse(value); } catch (error) { return value; }
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter(function (row) {
      const key = row && (row.id || row.itemId) || JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function inventoryFragment(state, department) {
    const source = state && typeof state === 'object' ? state : {};
    const data = source.data || {};
    const defaultDepartment = source.defaultDept || department;
    return {
      ...source,
      activeDept: department,
      defaultDept: department,
      departments: [department],
      deptPasswords: {},
      borrowerMemory: currentProfile && currentProfile.role === 'Admin' ? source.borrowerMemory || {} : {},
      data: {
        ...data,
        categories: (data.categories || [])
          .filter(function (row) { return (row.dept || defaultDepartment) === department; })
          .map(function (row) { return row.dept ? row : { ...row, dept: defaultDepartment }; }),
        offices: (data.offices || [])
          .filter(function (row) { return (row.dept || defaultDepartment) === department; })
          .map(function (row) { return row.dept ? row : { ...row, dept: defaultDepartment }; }),
        items: (data.items || [])
          .filter(function (row) { return (row.department || defaultDepartment) === department; })
          .map(function (row) { return row.department ? row : { ...row, department: defaultDepartment }; }),
        transactions: (data.transactions || []).filter(function (row) { return row.department === department || row.dept === department; }),
        savedDocs: (data.savedDocs || []).filter(function (row) {
          return row.department === department || row.dept === department || (!row.department && !row.dept && department === defaultDepartment);
        }),
        customColumns: data.customColumns || [],
      },
    };
  }

  function partitionLocalRecord(key, rawValue) {
    const moduleKey = getModuleForKey(key);
    if (!moduleKey || !canUseModule(moduleKey, 'write')) return [];
    const value = parseStoredValue(rawValue);
    if (key === 'dit_departments_v1') {
      if (currentProfile.role !== 'Admin') return [];
      return [{ recordKey: key, departmentScope: '__shared__', moduleKey: moduleKey, value: value }];
    }
    if (key === 'dit_stores_data_v32' || key === 'dit_stores_data_v33') {
      const state = value && typeof value === 'object' ? value : {};
      const departments = Array.isArray(state.departments) && state.departments.length
        ? state.departments
        : [...new Set((state.data && state.data.items || []).map(function (item) { return item.department; }).filter(Boolean))];
      return departments.filter(function (department) { return canUseDepartment(department, 'write'); })
        .map(function (department) {
          return {
            recordKey: deptRecordKey(key, department),
            departmentScope: department,
            moduleKey: moduleKey,
            value: inventoryFragment(state, department),
          };
        });
    }
    const safeKeepingMatch = key.match(/^safeKeeping(?:Items|Loans)_(.+)$/);
    if (safeKeepingMatch) {
      const department = safeKeepingMatch[1];
      if (!canUseDepartment(department, 'write')) return [];
      return [{ recordKey: key, departmentScope: department, moduleKey: moduleKey, value: value }];
    }
    if (/^safeKeeping(?:Items|Loans)$/.test(key)) {
      const department = currentProfile.department || 'DIT';
      if (!canUseDepartment(department, 'write')) return [];
      return [{ recordKey: key, departmentScope: department, moduleKey: moduleKey, value: value }];
    }
    return [{ recordKey: key, departmentScope: null, moduleKey: moduleKey, value: value }];
  }

  async function syncOneRecord(record, userId) {
    const key = record.recordKey;
    if (conflicts.has(key)) return;
    return queueForKey(key, async function () {
      const serialized = JSON.stringify(record.value);
      if (lastSyncedValues[key] === serialized) return;
      const currentVersion = versions[key];
      if (typeof currentVersion !== 'number') {
        const { data, error } = await (await getClient()).from('app_records').insert({
          record_key: key,
          module_key: record.moduleKey,
          department_scope: record.departmentScope,
          value: record.value,
          version: 1,
          updated_by: userId,
        }).select('version').maybeSingle();
        if (error) {
          if (error.code === '23505') {
            conflicts.add(key);
            showSyncError('A shared record changed during setup. Refresh before editing again.');
            return;
          }
          throw error;
        }
        if (!data) throw new Error('The database did not confirm the record write.');
        versions[key] = Number(data.version);
        lastSyncedValues[key] = serialized;
        return;
      }

      const { data, error } = await (await getClient()).from('app_records')
        .update({ value: record.value, version: currentVersion + 1, updated_by: userId, updated_at: new Date().toISOString() })
        .eq('record_key', key)
        .eq('version', currentVersion)
        .select('version')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        conflicts.add(key);
        showSyncError('This record changed on another device. Refresh before making more changes.');
        return;
      }
      versions[key] = Number(data.version);
      lastSyncedValues[key] = serialized;
    });
  }

  async function deleteRemoteRecord(key) {
    if (conflicts.has(key) || typeof versions[key] !== 'number') return;
    await queueForKey(key, async function () {
      const { data, error } = await (await getClient()).from('app_records')
        .delete()
        .eq('record_key', key)
        .eq('version', versions[key])
        .select('record_key')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        conflicts.add(key);
        showSyncError('This record changed on another device. Refresh before making more changes.');
        return;
      }
      delete versions[key];
      delete lastSyncedValues[key];
    });
  }

  async function getAccessToken() {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    return data.session && data.session.access_token || null;
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Could not load the Supabase browser client.')); };
      document.head.appendChild(script);
    });
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async function () {
        if (!window.supabase) await loadScript(cdnUrl);
        const config = window.DIT_SUPABASE_CONFIG;
        if (!config || !config.url || !config.publishableKey) throw new Error('Supabase configuration is missing.');
        return window.supabase.createClient(config.url, config.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
      })();
    }
    return clientPromise;
  }

  function showSyncError(message) {
    console.error('Dashboard cloud sync failed:', message);
    window.dispatchEvent(new CustomEvent('dit-cloud-sync-error', { detail: { message: message } }));
    if (typeof window.showToast === 'function') window.showToast(message, 'error', 8000);
  }

  function queueForKey(key, operation) {
    queues[key] = (queues[key] || Promise.resolve())
      .catch(function () {})
      .then(operation)
      .catch(function (error) {
        if (!conflicts.has(key)) showSyncError('A record could not be synced: ' + error.message);
      });
    return queues[key];
  }

  async function syncSet(key, value, oldValue) {
    const moduleKey = getModuleForKey(key);
    if (!moduleKey || isHydrating || conflicts.has(key)) return;
    const client = await getClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return;
    const records = partitionLocalRecord(key, value);
    for (const record of records) await syncOneRecord(record, authData.user.id);

    if (moduleKey === 'inventories' && (key === 'dit_stores_data_v32' || key === 'dit_stores_data_v33') && oldValue) {
      const oldState = parseStoredValue(oldValue);
      const newState = parseStoredValue(value);
      const oldDepartments = Array.isArray(oldState && oldState.departments) ? oldState.departments : [];
      const newDepartments = new Set(Array.isArray(newState && newState.departments) ? newState.departments : []);
      for (const department of oldDepartments) {
        if (!newDepartments.has(department) && canUseDepartment(department, 'delete')) {
          await deleteRemoteRecord(deptRecordKey(key, department));
        }
      }
    }
  }

  function patchBrowserStorage() {
    Storage.prototype.setItem = function (key, value) {
      const previousValue = this === window.localStorage ? this.getItem(String(key)) : null;
      nativeSetItem.call(this, key, value);
      if (this === window.localStorage && getModuleForKey(String(key))) {
        void syncSet(String(key), String(value), previousValue).catch(function (error) {
          showSyncError('A record could not be synced: ' + error.message);
        });
      }
    };

    Storage.prototype.removeItem = function (key) {
      const storage = this;
      const normalizedKey = String(key);
      const moduleKey = storage === window.localStorage ? getModuleForKey(normalizedKey) : null;
      nativeRemoveItem.call(storage, key);
      if (!moduleKey || isHydrating || conflicts.has(normalizedKey)) return;
      const recordKeys = Object.keys(versions).filter(function (recordKey) {
        const parsed = parseDeptRecordKey(recordKey);
        return recordKey === normalizedKey || (parsed && parsed.localKey === normalizedKey);
      });
      recordKeys.forEach(function (recordKey) {
        const parsed = parseDeptRecordKey(recordKey);
        if (parsed && !canUseDepartment(parsed.department, 'delete')) return;
        void deleteRemoteRecord(recordKey);
      });
    };

    Storage.prototype.clear = function () {
      const isSessionStorage = this === window.sessionStorage;
      nativeClear.call(this);
      if (isSessionStorage) {
        nativeRemoveItem.call(window.localStorage, 'sb-xpoiysklivftpzmflbdv-auth-token');
        void signOut().catch(function (error) {
          console.error('Could not sign out of Supabase.', error);
        });
      }
    };
  }

  function profileFromAuth(user) {
    const appMetadata = user.app_metadata || {};
    const userMetadata = user.user_metadata || {};
    return {
      id: user.id,
      email: user.email,
      username: userMetadata.username || user.email,
      fullName: userMetadata.full_name || userMetadata.fullName || user.email,
      role: appMetadata.role || 'User',
      modules: appMetadata.modules || {},
      department: appMetadata.department || '',
      departmentPrivileges: appMetadata.departmentPrivileges || {},
    };
  }

  async function functionErrorMessage(error, fallback) {
    let message = error && error.message || fallback;
    if (error && error.context && typeof error.context.json === 'function') {
      try {
        const details = await error.context.json();
        if (details && typeof details.error === 'string') message = details.error;
      } catch (readError) {
        console.error('Could not read the Edge Function error response.', readError);
      }
    }
    return message;
  }

  async function signIn(identifier, password) {
    const client = await getClient();
    const { data, error } = await client.functions.invoke('manage-users', {
      body: { action: 'sign_in', identifier: identifier.trim(), password: password },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'Could not sign in.'));
    if (!data || !data.session || !data.user) throw new Error(data && data.error || 'Invalid username/email or password.');
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (sessionError) throw sessionError;
    return data.user;
  }

  async function signOut() {
    const client = await getClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function requireSession() {
    const client = await getClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return profileFromAuth(data.user);
  }

  async function manageUsers(action, user, userId) {
    const client = await getClient();
    const payload = { action: action };
    if (user) payload.user = user;
    if (userId) payload.userId = userId;
    const { data, error } = await client.functions.invoke('manage-users', { body: payload });
    if (error) throw new Error(await functionErrorMessage(error, 'User management request failed.'));
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function mergeInventoryFragments(fragments, departments, preferredDept) {
    if (!fragments.length) return null;
    const first = fragments[0];
    const result = { ...first, departments: departments.slice() };
    const data = { ...first.data };
    ['categories', 'offices', 'items', 'transactions', 'savedDocs', 'customColumns'].forEach(function (key) {
      data[key] = uniqueRows(fragments.flatMap(function (fragment) {
        return fragment.data && Array.isArray(fragment.data[key]) ? fragment.data[key] : [];
      }));
    });
    result.data = data;
    result.departments = departments.slice();
    result.defaultDept = departments.includes(currentProfile && currentProfile.department)
      ? currentProfile.department
      : departments[0];
    result.activeDept = departments.includes(preferredDept) ? preferredDept : result.defaultDept;
    ['invoiceCounter', 'receiveInvoiceCounter'].forEach(function (key) {
      result[key] = fragments.reduce(function (maxValue, fragment) {
        return Math.max(maxValue, Number(fragment[key]) || 1);
      }, 1);
    });
    result.invoiceYear = fragments.reduce(function (year, fragment) {
      return Math.max(year, Number(fragment.invoiceYear) || new Date().getFullYear());
    }, new Date().getFullYear());
    if (!currentProfile || currentProfile.role !== 'Admin') result.borrowerMemory = {};
    return result;
  }

  async function hydrate() {
    const client = await getClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return false;
    await Promise.all(Object.values(queues));

    isHydrating = true;
    try {
      const { data: profile, error: profileError } = await client.from('app_profiles')
        .select('role, modules, department, department_privileges')
        .eq('user_id', authData.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error('Your account profile is missing. Ask an administrator to finish setup.');
      currentProfile = {
        ...profile,
        departmentPrivileges: profile.department_privileges || {},
      };
      const { data: remoteRows, error } = await client.from('app_records')
        .select('record_key, module_key, department_scope, value, version');
      if (error) throw error;
      const permittedRows = remoteRows || [];
      const remoteKeys = new Set();
      const localSnapshots = [];
      const localValues = new Map();
      const inventoryFragments = { dit_stores_data_v32: [], dit_stores_data_v33: [] };
      let sharedDepartments = null;
      let preferredDepartment = '';
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key && getModuleForKey(key)) localSnapshots.push([key, window.localStorage.getItem(key)]);
      }
      const oldInventory = localSnapshots.find(function (entry) { return entry[0] === 'dit_stores_data_v33'; }) ||
        localSnapshots.find(function (entry) { return entry[0] === 'dit_stores_data_v32'; });
      if (oldInventory) {
        const previousState = parseStoredValue(oldInventory[1]);
        preferredDepartment = previousState && previousState.activeDept || '';
      }

      localSnapshots.forEach(function ([key]) {
        nativeRemoveItem.call(window.localStorage, key);
      });
      permittedRows.forEach(function (row) {
        remoteKeys.add(row.record_key);
        versions[row.record_key] = Number(row.version);
        const parsedDeptKey = parseDeptRecordKey(row.record_key);
        if (parsedDeptKey) {
          inventoryFragments[parsedDeptKey.localKey].push(row.value);
          lastSyncedValues[row.record_key] = JSON.stringify(row.value);
        } else if (row.record_key === 'dit_departments_v1') {
          sharedDepartments = Array.isArray(row.value) ? row.value : [];
          lastSyncedValues[row.record_key] = JSON.stringify(row.value);
        } else {
          localValues.set(row.record_key, row.value);
          lastSyncedValues[row.record_key] = JSON.stringify(row.value);
        }
      });

      for (const [key, value] of localSnapshots) {
        for (const record of partitionLocalRecord(key, value)) {
          if (remoteKeys.has(record.recordKey)) continue;
          try {
            const { data, error: insertError } = await client.from('app_records').insert({
              record_key: record.recordKey,
              module_key: record.moduleKey,
              department_scope: record.departmentScope,
              value: record.value,
              version: 1,
              updated_by: authData.user.id,
            }).select('version').maybeSingle();
            if (insertError) {
              if (insertError.code === '23505') {
                const { data: existing, error: fetchError } = await client.from('app_records')
                  .select('value, version')
                  .eq('record_key', record.recordKey)
                  .maybeSingle();
                if (fetchError || !existing) {
                  showSyncError('A shared department record changed during setup. Refresh before editing again.');
                  continue;
                }
                versions[record.recordKey] = Number(existing.version);
                lastSyncedValues[record.recordKey] = JSON.stringify(existing.value);
                if (parseDeptRecordKey(record.recordKey)) inventoryFragments[parseDeptRecordKey(record.recordKey).localKey].push(existing.value);
                else localValues.set(record.recordKey, existing.value);
                remoteKeys.add(record.recordKey);
                continue;
              }
              throw insertError;
            }
            if (!data) throw new Error('The database did not confirm the initial record copy.');
            versions[record.recordKey] = Number(data.version);
            lastSyncedValues[record.recordKey] = JSON.stringify(record.value);
            remoteKeys.add(record.recordKey);
            if (parseDeptRecordKey(record.recordKey)) inventoryFragments[parseDeptRecordKey(record.recordKey).localKey].push(record.value);
            else if (record.recordKey === 'dit_departments_v1') sharedDepartments = record.value;
            else localValues.set(record.recordKey, record.value);
          } catch (insertError) {
            showSyncError('A saved local record could not be copied to the shared database: ' + insertError.message);
          }
        }
      }

      localValues.forEach(function (value, key) {
        nativeSetItem.call(window.localStorage, key, JSON.stringify(value));
      });

      const allDepartments = currentProfile.role === 'Admin'
        ? uniqueRows((sharedDepartments || []).map(function (name) { return { name: String(name) }; }).concat(
          inventoryFragments.dit_stores_data_v33.concat(inventoryFragments.dit_stores_data_v32)
            .flatMap(function (fragment) { return (fragment.departments || []).map(function (name) { return { name: String(name) }; }); }),
        )).map(function (entry) { return entry.name; })
        : Object.keys(currentProfile.department_privileges || {}).filter(function (department) {
          return canUseDepartment(department, 'view');
        });
      const departments = allDepartments.length ? allDepartments : ['DIT'];
      nativeSetItem.call(window.localStorage, 'dit_departments_v1', JSON.stringify(departments));

      ['dit_stores_data_v32', 'dit_stores_data_v33'].forEach(function (key) {
        const fragments = inventoryFragments[key];
        if (!fragments.length) return;
        const merged = mergeInventoryFragments(fragments, departments, preferredDepartment);
        if (merged) nativeSetItem.call(window.localStorage, key, JSON.stringify(merged));
      });
      conflicts.clear();
      return true;
    } finally {
      isHydrating = false;
    }
  }

  async function waitForPendingWrites() {
    await Promise.all(Object.values(queues));
  }

  patchBrowserStorage();
  window.ditCloudSync = Object.freeze({
    signIn: signIn,
    signOut: signOut,
    requireSession: requireSession,
    manageUsers: manageUsers,
    hydrate: hydrate,
    getAccessToken: getAccessToken,
    waitForPendingWrites: waitForPendingWrites,
  });
})();
