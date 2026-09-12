import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('seven Blender vehicles, menu, drive and cockpit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('art/qa', {recursive:true});
  await page.goto('/');
  await expect(page.locator('#vehiclePreview')).toHaveAttribute('data-asset','ready');
  await page.waitForTimeout(900);
  await page.screenshot({path:'art/qa/desktop-menu.png'});
  const ids=['mist-gt','apex-r','ridge-x','touring-s','trail-pickup','metro-bus','storm-moto'];
  for (const id of ids) {
    await page.locator(`[data-car="${id}"]`).click();
    await expect(page.locator('#vehiclePreview')).toHaveAttribute('data-asset','ready');
    const contract = await page.evaluate(async (id) => {
      const { loadVehicleAsset } = await import('/src/vehicle-assets.ts');
      const { createCar } = await import('/src/renderer.ts');
      const THREE = await import('/node_modules/three/build/three.module.js');
      await loadVehicleAsset(id);
      const car = createCar(0x809c8b, true,{model:id,color:0x809c8b,wheelColor:0xb8c1bd,spoiler:true});
      // Cockpits are hidden for exterior measurement.
      car.remove(car.userData.cockpit);
      const bounds = new THREE.Box3().setFromObject(car);
      return {version:car.userData.assetVersion,wheels:car.userData.wheels.length,steering:car.userData.frontWheels.length,minY:bounds.min.y,width:bounds.max.x-bounds.min.x,length:bounds.max.z-bounds.min.z};
    },id);
    expect(contract.version).toBe('delivery-atelier-1');
    expect(contract.wheels).toBe(id==='storm-moto'?2:4);
    expect(contract.steering).toBe(id==='storm-moto'?1:2);
    expect(contract.minY).toBeGreaterThan(-.05);
    expect(contract.length).toBeLessThan(8);
    expect(contract.width).toBeLessThan(3.2);
    await page.waitForTimeout(900);
    await page.screenshot({path:`art/qa/${id}.png`});
  }
  await page.locator('[data-car="mist-gt"]').click();
  await page.locator('#startButton').click();
  if(await page.locator('#tutorial').isVisible()) await page.locator('#tutorialSkipButton').click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud .route-chip')).toBeVisible();
  await expect(page.locator('[id^="delivery"], #cargoCake, [data-mode]')).toHaveCount(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1300);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#speed')).not.toHaveText('000');
  await page.screenshot({path:'art/qa/free-drive.png'});
  await page.keyboard.press('KeyC');
  await page.screenshot({path:'art/qa/cockpit.png'});
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#mainMenuButton').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
});

for(const viewport of [{width:390,height:844},{width:844,height:390},{width:820,height:1180}]) {
  test(`mobile menu and free drive ${viewport.width}x${viewport.height}`,async ({browser}) => {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const page=await context.newPage();
    await page.goto('http://localhost:4173');
    await expect(page.locator('#vehiclePreview')).toHaveAttribute('data-asset','ready');
    await expect(page.locator('#startButton')).toBeInViewport();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({path:`art/qa/mobile-${viewport.width}.png`});
    await page.locator('#startButton').click();
    if(await page.locator('#tutorial').isVisible())await page.locator('#tutorialSkipButton').click();
    await expect(page.locator('#touchJoystick')).toBeVisible();
    await expect(page.locator('#mobileCameraButton')).toBeInViewport();
    await page.screenshot({path:`art/qa/mobile-drive-${viewport.width}.png`});
    await context.close();
  });
}
