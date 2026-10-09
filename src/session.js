import { join } from 'node:path';
import {
  listBrowserProfiles,
  listCookieSources,
  readBrowserCookies,
} from 'browser-commander';

export async function sessionSources(domain = 'lazada.vn') {
  const profiles = await listBrowserProfiles();
  const sources = await listCookieSources({ domains: [domain] });
  return {
    profiles: profiles.map(({ browser, name, error }) => ({
      browser,
      profile: name,
      ...(error ? { error } : {}),
    })),
    sources: sources.map(({ browser, profile, byDomain, error }) => ({
      browser,
      profile,
      cookieCount: byDomain?.[domain] ?? 0,
      ...(error ? { error } : {}),
    })),
  };
}

export async function importSession({
  directory,
  domain = 'lazada.vn',
  browser = 'auto',
  profile,
} = {}) {
  let selected = { browser, profile };
  if (browser === 'auto') {
    const { sources } = await sessionSources(domain);
    const available = sources
      .filter((source) => source.cookieCount > 0 && !source.error)
      .sort((a, b) => b.cookieCount - a.cookieCount);
    if (!available.length) {
      const errors = sources
        .filter((source) => source.error)
        .map((source) => `${source.browser}: ${source.error}`);
      throw new Error(
        `No readable existing session for ${domain}. ${errors.join('; ')}`
      );
    }
    selected = available[0];
  }
  const cookies = await readBrowserCookies({
    browser: selected.browser,
    profile: selected.profile,
    domainFilter: domain,
    cache: { dir: join(directory, '.session-cache'), ttlMinutes: 30 },
  });
  const scoped = cookies.filter((cookie) => {
    const host = cookie.domain.replace(/^\./u, '');
    return host === domain || host.endsWith(`.${domain}`);
  });
  if (!scoped.length) {
    throw new Error(`No ${domain} cookies in ${selected.browser}`);
  }
  return {
    cookies: scoped,
    summary: {
      browser: selected.browser,
      profile: selected.profile,
      cookieCount: scoped.length,
    },
  };
}
