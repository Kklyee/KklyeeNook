"use client";

import type { FC } from "react";
import type { ShikiHighlighterProps } from "react-shiki";
import type { SyntaxHighlighterProps as AUIProps } from "@assistant-ui/react-markdown";
import { useIsCodeFenceIncomplete } from "streamdown";
import {
  resolveCodeLanguage,
  SyntaxHighlighter as SyntaxHighlighterBase,
} from "./shiki-highlighter";

export type HighlighterProps = Omit<
  ShikiHighlighterProps,
  "children" | "theme"
> & {
  theme?: ShikiHighlighterProps["theme"];
} & Pick<AUIProps, "language" | "code"> &
  Partial<Pick<AUIProps, "node" | "components">>;

export const SyntaxHighlighter: FC<HighlighterProps> = ({
  node: _node,
  components: _components,
  ...props
}) => {
  const incomplete = useIsCodeFenceIncomplete();
  if (incomplete) {
    return <pre className="aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed"><code>{props.code}</code></pre>;
  }
  return (
    <SyntaxHighlighterBase
      {...props}
      language={resolveCodeLanguage(props.language, props.code)}
    />
  );
};

SyntaxHighlighter.displayName = "SyntaxHighlighter";
