"use client";

import type { FC } from "react";
import type { ShikiHighlighterProps } from "react-shiki";
import type { SyntaxHighlighterProps as AUIProps } from "@assistant-ui/react-markdown";
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
  return (
    <SyntaxHighlighterBase
      {...props}
      language={resolveCodeLanguage(props.language, props.code)}
    />
  );
};

SyntaxHighlighter.displayName = "SyntaxHighlighter";
