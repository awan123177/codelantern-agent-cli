import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { Entry } from '@napi-rs/keyring';

export interface INativeCredentialStore {
  name: string;
  isAvailable(): boolean;
  get(service: string, account: string): string | null;
  set(service: string, account: string, secret: string): boolean;
  delete(service: string, account: string): boolean;
}

/**
 * Primary native store using @napi-rs/keyring (precompiled N-API binding).
 * Uses Keychain on macOS, Windows Credential Manager on Windows, and Secret Service on Linux.
 */
class NapiRsKeyringStore implements INativeCredentialStore {
  public name: string;

  constructor() {
    this.name = this.resolveStoreName();
  }

  private resolveStoreName(): string {
    if (process.platform === 'darwin') return 'macOS Keychain';
    if (process.platform === 'win32') return 'Windows Credential Manager';
    if (process.platform === 'linux') return 'Linux Secret Service / Keyring';
    return 'OS Credential Store';
  }

  public isAvailable(): boolean {
    return typeof Entry === 'function';
  }

  public get(service: string, account: string): string | null {
    try {
      const entry = new Entry(service, account);
      const res = entry.getPassword();
      return res ?? null;
    } catch {
      return null;
    }
  }

  public set(service: string, account: string, secret: string): boolean {
    try {
      const entry = new Entry(service, account);
      entry.setPassword(secret);
      return true;
    } catch {
      return false;
    }
  }

  public delete(service: string, account: string): boolean {
    try {
      const entry = new Entry(service, account);
      return entry.deletePassword();
    } catch {
      return false;
    }
  }
}

/**
 * Native macOS CLI fallback using /usr/bin/security (Apple Keychain Services)
 */
class MacosKeychainCliStore implements INativeCredentialStore {
  public name = 'macOS Keychain (CLI)';

  public isAvailable(): boolean {
    return process.platform === 'darwin';
  }

  public get(service: string, account: string): string | null {
    if (process.platform !== 'darwin') return null;
    try {
      const output = execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  public set(service: string, account: string, secret: string): boolean {
    if (process.platform !== 'darwin') return false;
    try {
      execFileSync(
        '/usr/bin/security',
        ['add-generic-password', '-U', '-s', service, '-a', account, '-w', secret],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return true;
    } catch {
      return false;
    }
  }

  public delete(service: string, account: string): boolean {
    if (process.platform !== 'darwin') return false;
    try {
      execFileSync(
        '/usr/bin/security',
        ['delete-generic-password', '-s', service, '-a', account],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Windows PowerShell / Credential Manager fallback
 */
class WindowsCredentialManagerCliStore implements INativeCredentialStore {
  public name = 'Windows Credential Manager (PowerShell)';

  public isAvailable(): boolean {
    return process.platform === 'win32';
  }

  public get(service: string, account: string): string | null {
    if (process.platform !== 'win32') return null;
    try {
      const target = `${service}:${account}`;
      const psScript = `
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class WinCred {
            [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredReadW", CharSet = CharSet.Unicode)]
            public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
            [DllImport("Advapi32.dll", SetLastError = true)]
            public static extern void CredFree([In] IntPtr cred);
            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
            public struct CREDENTIAL {
                public uint Flags; public uint Type; public string TargetName; public string Comment;
                public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
                public uint CredentialBlobSize; public IntPtr CredentialBlob;
                public uint Persist; public uint AttributeCount; public IntPtr Attributes;
                public string TargetAlias; public string UserName;
            }
            public static string Read(string target) {
                IntPtr ptr;
                if (!CredRead(target, 1, 0, out ptr)) return null;
                var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
                byte[] bytes = new byte[cred.CredentialBlobSize];
                Marshal.Copy(cred.CredentialBlob, bytes, 0, (int)cred.CredentialBlobSize);
                CredFree(ptr);
                return System.Text.Encoding.Unicode.GetString(bytes);
            }
        }
"@
        [WinCred]::Read("${target.replace(/"/g, '`"')}")
      `;
      const output = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
      );
      const res = output.trim();
      return res.length > 0 ? res : null;
    } catch {
      return null;
    }
  }

  public set(service: string, account: string, secret: string): boolean {
    if (process.platform !== 'win32') return false;
    try {
      const target = `${service}:${account}`;
      const psScript = `
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class WinCredWrite {
            [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredWriteW", CharSet = CharSet.Unicode)]
            public static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] uint flags);
            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
            public struct CREDENTIAL {
                public uint Flags; public uint Type; public string TargetName; public string Comment;
                public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
                public uint CredentialBlobSize; public IntPtr CredentialBlob;
                public uint Persist; public uint AttributeCount; public IntPtr Attributes;
                public string TargetAlias; public string UserName;
            }
            public static bool Write(string target, string user, string secret) {
                byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret);
                IntPtr bPtr = Marshal.AllocHGlobal(bytes.Length);
                Marshal.Copy(bytes, 0, bPtr, bytes.Length);
                var c = new CREDENTIAL {
                    Flags = 0, Type = 1, TargetName = target, UserName = user,
                    CredentialBlobSize = (uint)bytes.Length, CredentialBlob = bPtr, Persist = 2
                };
                bool ok = CredWrite(ref c, 0);
                Marshal.FreeHGlobal(bPtr);
                return ok;
            }
        }
"@
        [WinCredWrite]::Write("${target.replace(/"/g, '`"')}", "${account.replace(/"/g, '`"')}", "${secret.replace(/"/g, '`"')}")
      `;
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return true;
    } catch {
      return false;
    }
  }

  public delete(service: string, account: string): boolean {
    if (process.platform !== 'win32') return false;
    try {
      const target = `${service}:${account}`;
      const psScript = `
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class WinCredDel {
            [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode)]
            public static extern bool CredDelete(string target, int type, int reservedFlag);
            public static bool Del(string target) { return CredDelete(target, 1, 0); }
        }
"@
        [WinCredDel]::Del("${target.replace(/"/g, '`"')}")
      `;
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return true;
    } catch {
      return false;
    }
  }
}

export class NativeCredentialStore {
  private static instance: NativeCredentialStore;
  private primaryStore: INativeCredentialStore;
  private fallbackStore: INativeCredentialStore | null = null;

  private constructor() {
    this.primaryStore = new NapiRsKeyringStore();
    if (process.platform === 'darwin') {
      this.fallbackStore = new MacosKeychainCliStore();
    } else if (process.platform === 'win32') {
      this.fallbackStore = new WindowsCredentialManagerCliStore();
    }
  }

  public static getInstance(): NativeCredentialStore {
    if (!NativeCredentialStore.instance) {
      NativeCredentialStore.instance = new NativeCredentialStore();
    }
    return NativeCredentialStore.instance;
  }

  public getStoreName(): string {
    if (process.platform === 'darwin') return 'macOS Keychain';
    if (process.platform === 'win32') return 'Windows Credential Manager';
    if (process.platform === 'linux') return 'Linux Secret Service / Keyring';
    return 'OS Credential Store';
  }

  public isAvailable(): boolean {
    return this.primaryStore.isAvailable() || (this.fallbackStore?.isAvailable() ?? false);
  }

  public get(service: string, account: string): string | null {
    if (this.primaryStore.isAvailable()) {
      try {
        const val = this.primaryStore.get(service, account);
        if (val) return val;
      } catch {
        // try fallback
      }
    }

    if (this.fallbackStore && this.fallbackStore.isAvailable()) {
      try {
        return this.fallbackStore.get(service, account);
      } catch {
        return null;
      }
    }

    return null;
  }

  public set(service: string, account: string, secret: string): boolean {
    let succeeded = false;

    if (this.primaryStore.isAvailable()) {
      try {
        succeeded = this.primaryStore.set(service, account, secret);
      } catch {
        succeeded = false;
      }
    }

    if (!succeeded && this.fallbackStore && this.fallbackStore.isAvailable()) {
      try {
        succeeded = this.fallbackStore.set(service, account, secret);
      } catch {
        succeeded = false;
      }
    }

    return succeeded;
  }

  public delete(service: string, account: string): boolean {
    let deleted = false;

    if (this.primaryStore.isAvailable()) {
      try {
        deleted = this.primaryStore.delete(service, account) || deleted;
      } catch {
        // ignore
      }
    }

    if (this.fallbackStore && this.fallbackStore.isAvailable()) {
      try {
        deleted = this.fallbackStore.delete(service, account) || deleted;
      } catch {
        // ignore
      }
    }

    return deleted;
  }
}
