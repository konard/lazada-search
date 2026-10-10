// Phone numbers and verification codes belong to the private browser profile,
// never to product records or public evidence. Return only authentication state.
import { resolvePageDialogs } from './page-dialogs.js';
export function vietnamPhoneNumber(value) {
  const digits = String(value || '').replace(/[\s()+.-]/gu, '');
  const national = digits.startsWith('84') ? `0${digits.slice(2)}` : digits;
  if (!/^0[35789]\d{8}$/u.test(national)) {
    throw new Error('A valid Vietnamese mobile number is required');
  }
  return national;
}

export function phoneLoginState(page) {
  return page.evaluate(() => {
    const document = globalThis.document;
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        (!element.checkVisibility ||
          element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }))
      );
    };
    const text = document.body.innerText || '';
    const elements = [
      ...document.querySelectorAll('a,button,[role="button"]'),
    ].filter(visible);
    const account = document.getElementById('myAccountTrigger');
    if (
      (account &&
        visible(account) &&
        /^TÀI KHOẢN\s+\S/iu.test(account.innerText.trim())) ||
      elements.some((element) =>
        /^(?:logout|log out|đăng xuất)$/iu.test(element.innerText.trim())
      )
    ) {
      return { status: 'authenticated' };
    }
    if (
      [...document.querySelectorAll('iframe')].some(
        (element) =>
          visible(element) &&
          /captcha|punish|secverify|nocaptcha/iu.test(element.src)
      ) ||
      /slide to verify|security verification|verify to continue|xác minh bảo mật/iu.test(
        text
      )
    ) {
      return { status: 'challenge' };
    }
    if (/please enter a valid phone number/iu.test(text)) {
      return { status: 'invalid-phone' };
    }
    if (
      [...document.querySelectorAll('input')].some(
        (element) =>
          visible(element) &&
          (element.autocomplete === 'one-time-code' ||
            /verification code|OTP|mã xác minh/iu.test(element.placeholder))
      ) ||
      /enter (?:the |your )?(?:(?:sms |verification )?code|OTP)|nhập mã (?:OTP|xác minh)/iu.test(
        text
      )
    ) {
      return { status: 'otp-required' };
    }
    return { status: 'pending' };
  });
}

async function selectPhoneTab(page) {
  const phoneTab = page.getByText('Phone Number', { exact: true });
  if (!(await phoneTab.isVisible())) {
    await page
      .getByText(/^(?:ĐĂNG NHẬP|LOGIN|LOG IN)$/u)
      .first()
      .click();
  }
  await phoneTab.click();
}

export async function startPhoneLogin(
  collector,
  {
    phone,
    channel = 'zalo',
    url = 'https://member.lazada.vn/user/login',
    timeoutMs = 15000,
  } = {}
) {
  if (!['zalo', 'sms'].includes(channel)) {
    throw new Error('Authentication channel must be zalo or sms');
  }
  if (collector.store?.visibility !== 'private') {
    throw new Error('Phone login requires a private account store');
  }
  const national = vietnamPhoneNumber(phone);
  await collector.start();
  await collector.runtime.touch?.();
  const existing = await phoneLoginState(collector.runtime.page);
  if (['authenticated', 'challenge'].includes(existing.status)) {
    return existing;
  }
  await resolvePageDialogs(collector.runtime.page);
  await collector.runtime.pace?.(url, collector.cache.scheduler.intervalMs);
  await collector.commander.goto({
    url,
    waitUntil: 'domcontentloaded',
    waitForNetworkIdle: false,
  });
  const page = collector.runtime.page;
  const current = await phoneLoginState(page);
  if (['authenticated', 'challenge'].includes(current.status)) {
    return current;
  }
  await selectPhoneTab(page);
  const input = page.locator('input:visible[placeholder*="phone number" i]');
  await input.fill(national.slice(1));
  // Only one request per invocation; resending requires a deliberate new run.
  const name =
    channel === 'zalo'
      ? /^(?:Gửi mã OTP qua Zalo|Send (?:code |OTP )?(?:via |by )?Zalo)$/iu
      : /^(?:Gửi mã qua SMS|Send (?:code |OTP )?(?:via |by )?SMS)$/iu;
  await page.getByRole('button', { name }).click();
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await phoneLoginState(page);
    if (state.status !== 'pending') {
      return state;
    }
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return {
    status: 'pending',
    reason: 'The site has not presented a verification result yet',
  };
}

export async function submitPhoneCode(
  collector,
  code,
  { timeoutMs = 15000 } = {}
) {
  if (collector.store?.visibility !== 'private') {
    throw new Error('Verification requires a private account store');
  }
  if (!/^\d{4,8}$/u.test(String(code))) {
    throw new Error('Verification code must contain 4 to 8 digits');
  }
  const page = collector.runtime?.page;
  if (!page || (await phoneLoginState(page)).status !== 'otp-required') {
    throw new Error('No active OTP form; start phone login first');
  }
  await collector.runtime.touch?.();
  const input = page.locator(
    'input:visible:not([type="search"]):not([type="hidden"]):not([readonly])'
  );
  if ((await input.count()) !== 1) {
    throw new Error('The verification form does not have a single code field');
  }
  await input.fill(String(code));
  await page
    .getByRole('button', { name: /^(?:Confirm|Verify|LOGIN)$/u })
    .click();
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await phoneLoginState(page);
    if (['authenticated', 'challenge'].includes(state.status)) {
      return state;
    }
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return phoneLoginState(page);
}
