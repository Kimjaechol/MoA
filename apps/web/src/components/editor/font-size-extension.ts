/**
 * TipTap FontSize Extension
 *
 * Custom extension that adds fontSize support to TextStyle marks.
 * TipTap doesn't ship a built-in fontSize extension, so we extend
 * the TextStyle mark to handle `fontSize` as a style attribute.
 */

import { Extension } from "@tiptap/react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }: { chain: CallableFunction }) => {
          return chain().setMark("textStyle", { fontSize }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }: { chain: CallableFunction }) => {
          return chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
        },
    };
  },
});
