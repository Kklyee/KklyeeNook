export function resolveCodeLanguage(language: string | undefined, code: string) {
  const source = code.trim();
  const declaredLanguage = language?.trim().toLowerCase();
  if (declaredLanguage) return declaredLanguage;
  if (!source) return 'text';

  if (source.startsWith("{") || source.startsWith("[")) {
    try {
      JSON.parse(source);
      return 'json';
    } catch {}
  }

  if (/^\s*(?:#!.*\b(?:bash|sh)\b|(?:\$\s*)?(?:npm|npx|pnpm|yarn|bun|git|node|cd|ls|curl|echo)\b)/m.test(source)) {
    return 'bash';
  }

  if (/^\s*(?:def\s+\w+\s*\(|from\s+[\w.]+\s+import\s+|class\s+\w+\s*:\s*$)/m.test(source)) {
    return 'python';
  }

  if (/<\/?[A-Za-z][\w:-]*(?:\s|\/?>)/.test(source)) {
    return /\b(?:className|on[A-Z]\w*)\s*=|\{\s*[\w$.(]/.test(source) ? 'tsx' : 'html';
  }

  if (/\b(?:interface|type)\s+\w+|\b(?:const|let|var|function|return|export|import)\b|=>/.test(source)) {
    return 'typescript';
  }

  return 'text';
}

