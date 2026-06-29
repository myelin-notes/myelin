// @ungap/structured-clone ships no type declarations; declare the default
// export we use (a structuredClone-compatible deep clone).
declare module '@ungap/structured-clone' {
  export default function structuredClone<T>(
    value: T,
    options?: { lossy?: boolean },
  ): T;
}
