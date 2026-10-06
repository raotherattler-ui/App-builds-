import { Text, Linking, type TextStyle, type StyleProp } from "react-native";
import { useTheme } from "@/src/theme";

/**
 * Renders text with any URLs auto-detected and converted into tappable links.
 * Supports http(s)://, www., bare domains, YouTube short URLs (youtu.be),
 * and common patterns used in product descriptions.
 */
const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s<>()]+|(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))[A-Za-z0-9_-]+)/gi;

function normalizeUrl(raw: string): string {
  let u = raw.replace(/[),.;!?]+$/, ""); // strip trailing punctuation
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export function LinkifiedText({
  children,
  style,
  linkStyle,
  numberOfLines,
}: {
  children: string | undefined | null;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const theme = useTheme();
  const text = children ?? "";
  if (!text) return <Text style={style}>{""}</Text>;

  const parts: { t: "text" | "url"; v: string }[] = [];
  let lastIdx = 0;
  const re = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ t: "text", v: text.slice(lastIdx, m.index) });
    parts.push({ t: "url", v: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ t: "text", v: text.slice(lastIdx) });

  const defaultLink: TextStyle = {
    color: "#9ACD32",
    textDecorationLine: "underline",
    fontFamily: theme.font.text,
  };

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) => {
        if (p.t === "text") return <Text key={i}>{p.v}</Text>;
        const target = normalizeUrl(p.v);
        return (
          <Text
            key={i}
            style={[defaultLink, linkStyle]}
            onPress={() => Linking.openURL(target).catch(() => {})}
            accessibilityRole="link"
            accessibilityHint={`Opens ${target}`}
            suppressHighlighting
          >
            {p.v}
          </Text>
        );
      })}
    </Text>
  );
}
