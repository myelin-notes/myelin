import { useEffect, useState } from 'react';
import { UserPrefs } from './user-prefs';

type UserPrefsKey = Parameters<typeof UserPrefs.get>[0];
type UserPrefValue<K extends UserPrefsKey> = ReturnType<
  typeof UserPrefs.get<K>
>;

export function useUserPref<K extends UserPrefsKey>(key: K): UserPrefValue<K> {
  const [value, setValue] = useState<UserPrefValue<K>>(() =>
    UserPrefs.get(key),
  );
  useEffect(
    () => UserPrefs.subscribe(key, setValue as (v: UserPrefValue<K>) => void),
    [key],
  );
  return value;
}
