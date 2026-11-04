import * as yaml from "js-yaml";

const YAML_DELIMITER = "---";

function parse(content) {
  const lines = content.split("\n");
  if (lines[0] !== YAML_DELIMITER) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = lines.indexOf(YAML_DELIMITER, 1);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = lines.slice(1, endIndex).join("\n");
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");

  try {
    return { frontmatter: yaml.load(yamlContent) || {}, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function format(content) {
  const { frontmatter, body } = parse(content);
  if (Object.keys(frontmatter).length === 0) {
    return content;
  }

  const kept = Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
  const yamlStr = yaml.dump(kept, {
    lineWidth: -1,
    quoteStyle: "double",
    forceQuotes: true,
    noRefs: true,
    sortKeys: false,
  });

  return `${YAML_DELIMITER}\n${yamlStr}${YAML_DELIMITER}\n\n${body}`;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  process.stdout.write(format(input));
});
