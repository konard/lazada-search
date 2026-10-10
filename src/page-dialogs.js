export async function resolvePageDialogs(page) {
  const confirm = page.getByText('Xác nhận', { exact: true });
  if (await confirm.isVisible()) {
    let dialog = confirm;
    let recognized = false;
    for (let index = 0; index < 6; index++) {
      dialog = dialog.locator('xpath=..');
      if (await dialog.evaluate((element) => element.tagName === 'BODY')) {
        break;
      }
      const text = await dialog.innerText();
      if (
        /Thông tin này chỉ mang tính chất trợ giúp tìm hiểu về sản phẩm/u.test(
          text
        ) &&
        /hoặc có nhu cầu tìm hiểu về sản phẩm/u.test(text)
      ) {
        recognized = true;
        break;
      }
    }
    if (!recognized) {
      throw new Error('Unresolved product-information dialog');
    }
    // This explicitly includes people who want to learn about the product.
    // It does not assert that the user is a healthcare professional.
    const checkbox = dialog.locator('input[type="checkbox"]');
    if (
      (await checkbox.count()) === 1 &&
      /Không hỏi lại/u.test(await dialog.innerText())
    ) {
      await checkbox.check();
    }
    await confirm.click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
  }
  if (
    await page
      .locator(
        '[role="dialog"]:visible, .next-dialog:visible, .ant-modal:visible'
      )
      .count()
  ) {
    throw new Error(
      'Unresolved page dialog; collection paused before extraction'
    );
  }
}
