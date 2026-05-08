const RICH_NOTE_TAG_RE =
  /<\/?(?:a|b|blockquote|br|div|em|font|h[1-6]|i|li|ol|p|s|span|strike|strong|u|ul)(?:\s[^>]*)?>/i;

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToRichHtml(value: string) {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

export function normalizeStoredNoteHtml(value: string | null | undefined) {
  const note = value ?? "";
  if (!note.trim()) {
    return "";
  }
  return RICH_NOTE_TAG_RE.test(note) ? sanitizeRichTextHtml(note) : textToRichHtml(note);
}

export function richTextToPlainText(value: string | null | undefined) {
  const note = value ?? "";
  if (!note) {
    return "";
  }
  if (typeof document !== "undefined") {
    const element = document.createElement("div");
    element.innerHTML = normalizeStoredNoteHtml(note);
    return (element.innerText || element.textContent || "").replace(/\u00a0/g, " ").trim();
  }
  return note
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|li|p)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function isRichTextEmpty(value: string | null | undefined) {
  return richTextToPlainText(value).length === 0;
}

export function sanitizeRichTextHtml(value: string | null | undefined) {
  const note = value ?? "";
  if (!note) {
    return "";
  }
  if (typeof document === "undefined") {
    return note
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "");
  }

  const allowedTags = new Set([
    "A",
    "B",
    "BLOCKQUOTE",
    "BR",
    "DIV",
    "EM",
    "FONT",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "I",
    "LI",
    "OL",
    "P",
    "S",
    "SPAN",
    "STRIKE",
    "STRONG",
    "U",
    "UL",
  ]);
  const container = document.createElement("div");
  container.innerHTML = note;
  container.querySelectorAll("script,style,iframe,object,embed").forEach((element) => element.remove());
  Array.from(container.querySelectorAll("*")).forEach((element) => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      const isSafeHref =
        element.tagName === "A" &&
        name === "href" &&
        /^(https?:|mailto:|tel:|#|\/)/i.test(value);
      if (isSafeHref) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noreferrer");
        return;
      }
      if (name === "style") {
        const safeDeclarations = value
          .split(";")
          .map((part) => part.trim())
          .filter((part) => /^(color|text-align)\s*:/i.test(part));
        if (safeDeclarations.length > 0) {
          element.setAttribute("style", safeDeclarations.join("; "));
          return;
        }
      }
      if (element.tagName === "FONT" && name === "color") {
        return;
      }
      if (name === "target" || name === "rel") {
        return;
      }
      element.removeAttribute(attribute.name);
    });
  });
  return container.innerHTML;
}
