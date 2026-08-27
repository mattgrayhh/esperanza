// =============================================================================
// esperanza-cf — tiny CLI arg parser + shared run context for the Phase 2 scripts.
// No external dep; just enough to read --flag and --key=value.
// =============================================================================

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
}

export function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) values.set(a.slice(2, eq), a.slice(eq + 1));
      else flags.add(a.slice(2));
    } else {
      positional.push(a);
    }
  }
  return { flags, values, positional };
}

export function getMode(args: Args): 'local' | 'remote' {
  if (args.flags.has('remote')) return 'remote';
  return 'local'; // default to local D1
}

/** Pretty number with thousands separators. */
export function n(x: number): string {
  return x.toLocaleString('en-US');
}

export function bytesHuman(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
