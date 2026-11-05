export const REPOSITORY_URL = "https://github.com/Arturgrr/librelog";
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;
export const DOCS_URL = `${REPOSITORY_URL}/tree/main/docs`;

export function docsUrl(page: string, section?: string) {
  const url = `${REPOSITORY_URL}/blob/main/docs/${page}.mdx`;
  return section ? `${url}#${section}` : url;
}
