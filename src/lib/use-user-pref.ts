import { useEffect, useState } from 'react';
import {
  UserPrefs,
  type UserPrefsKey,
  type UserPrefValue,
} from '@myelin/editor/user-prefs';

export function useUserPref<K extends UserPrefsKey>(key: K): UserPrefValue<K> {
  const [value, setValue] = useState<UserPrefValue<K>>(() =>
    UserPrefs.get(key),
  );
  useEffect(() => {
    const set = setValue as (v: UserPrefValue<K>) => void;
    set(UserPrefs.get(key));
    return UserPrefs.subscribe(key, set);
  }, [key]);
  return value;
}
