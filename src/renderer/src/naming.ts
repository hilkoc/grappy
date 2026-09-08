const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

export function isValidIdentifier(candidate: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) && !PYTHON_KEYWORDS.has(candidate);
}

/**
 * Turn a node name into the Python variable name that holds its value: runs of whitespace
 * become a single underscore, leading and trailing underscores are stripped, and a result
 * that is not a valid identifier (a leading digit, say) gets an underscore in front.
 *
 * The result can still be invalid — `a-b` has no repair — so callers must validate it.
 */
export function deriveVarName(name: string): string {
  const collapsed = name.replace(/\s+/g, '_').replace(/^_+/, '').replace(/_+$/, '');
  return isValidIdentifier(collapsed) ? collapsed : `_${collapsed}`;
}

export interface NameCheck {
  varName: string;
  error: string | null;
}

/** Validate a node name at creation time against the names already on the canvas. */
export function checkNodeName(name: string, takenVarNames: Iterable<string>): NameCheck {
  const trimmed = name.trim();
  if (!trimmed) {
    return { varName: '', error: 'Enter a name.' };
  }

  const varName = deriveVarName(trimmed);
  if (!isValidIdentifier(varName)) {
    return { varName, error: `"${trimmed}" does not turn into a valid Python name.` };
  }
  for (const taken of takenVarNames) {
    if (taken === varName) {
      return { varName, error: `Another node already uses the variable "${varName}".` };
    }
  }
  return { varName, error: null };
}
