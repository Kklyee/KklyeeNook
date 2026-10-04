"use client";

import { useMemo, type FC } from "react";
import { useShikiHighlighter, type ShikiHighlighterProps } from "react-shiki";
import { cn } from "@/renderer/src/lib/utils";

export type SyntaxHighlighterProps = Omit<
  ShikiHighlighterProps,
  "children" | "theme"
> & {
  theme?: ShikiHighlighterProps["theme"];
  code: string;
  highlightLines?: readonly number[] | undefined;
};

const containerClassName =
  "aui-shiki-base [&_pre]:border-border/50 [&_pre]:bg-[var(--ui-surface-muted)]! [&_pre]:text-[var(--ui-fg)]! [&_.line]:px-0! [&_pre]:overflow-x-auto [&_pre]:rounded-t-none [&_pre]:rounded-b-xl [&_pre]:border [&_pre]:border-t-0 [&_pre]:p-3.5 [&_pre]:text-[13px] [&_pre]:leading-relaxed";

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

const createHighlightedLinesTransformer = (
  highlightLines: readonly number[],
): NonNullable<ShikiHighlighterProps["transformers"]>[number] => {
  const highlightedLines = new Set(highlightLines);

  return {
    name: "assistant-ui:highlight-lines",
    line(node, line) {
      if (highlightedLines.has(line)) {
        this.addClassToHast(node, "highlighted");
      }
      return node;
    },
  };
};

const PlainCode: FC<{ code: string }> = ({ code }) => (
  <pre>
    <code>{code}</code>
  </pre>
);

const HighlightedCode: FC<{
  code: string;
  language: SyntaxHighlighterProps["language"];
  theme: NonNullable<SyntaxHighlighterProps["theme"]>;
  options: Omit<ShikiHighlighterProps, "children" | "language" | "theme">;
}> = ({ code, language, theme, options }) => {
  const highlighted = useShikiHighlighter(code, language, theme, {
    ...options,
    defaultColor: "light-dark()",
  });
  return <>{highlighted ?? <PlainCode code={code} />}</>;
};

export const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({
  code,
  language,
  theme = { dark: "github-dark-default", light: "github-light-default" },
  className,
  style,
  addDefaultStyles: _addDefaultStyles,
  showLanguage: _showLanguage,
  delay = 150,
  highlightLines,
  ...options
}) => {
  const trimmed = code.trim();
  const highlightKey = highlightLines?.join(",") ?? "";
  const callerTransformers = options.transformers;
  const transformers = useMemo(
    () =>
      highlightKey
        ? [
            ...(callerTransformers ?? []),
            createHighlightedLinesTransformer(
              highlightKey.split(",").map(Number),
            ),
          ]
        : callerTransformers,
    [highlightKey, callerTransformers],
  );

  return (
    <div
      className={cn(containerClassName, className)}
      style={style}
    >
      <HighlightedCode
        code={trimmed}
        language={language}
        theme={theme}
        options={
          transformers
            ? { ...options, delay, transformers }
            : { ...options, delay }
        }
      />
    </div>
  );
};

SyntaxHighlighter.displayName = "SyntaxHighlighter";
