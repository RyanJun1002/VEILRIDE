import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('cargo rules: gentle/harsh, collision cooldown, destination, reset, disabled', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { DeliveryRun } = await import('/src/delivery.ts');
    const { DrivingSimulation } = await import('/src/simulation.ts');
    const p = new DrivingSimulation().player;
    const gentle = new DeliveryRun();
    for (let i=0;i<600;i++) { p.forwardSpeed = i/60; gentle.update(1/60,p); }
    const gentleHealth = gentle.integrity;
    p.forwardSpeed = 20; p.yawRate = .6;
    const harsh = new DeliveryRun(); harsh.reset(20);
    for(let i=0;i<240;i++) harsh.update(1/60,p);
    const harshHealth = harsh.integrity;
    p.forwardSpeed = p.yawRate = 0;
    const crash = new DeliveryRun();
    for(let i=0;i<30;i++) crash.update(1/60,p,true);
    const crashHealth = crash.integrity;
    const run = new DeliveryRun(); p.z=run.targetZ;p.x=run.targetX;
    p.forwardSpeed=5;
    for(let i=0;i<120;i++)run.update(1/60,p);
    const movingStatus=run.status;
    p.forwardSpeed=0;run.reset();
    for(let i=0;i<100;i++)run.update(1/60,p);
    const stoppedStatus=run.status;
    run.reset();p.x+=6;
    for(let i=0;i<120;i++)run.update(1/60,p);
    const outsideStatus=run.status;
    run.enabled=false;run.update(.05,p,true);
    return {gentleHealth,harshHealth,crashHealth,movingStatus,stoppedStatus,outsideStatus,disabledHealth:run.integrity,grade:run.grade};
  });
  expect(result.gentleHealth).toBe(100);
  expect(result.harshHealth).toBeLessThan(85);
  expect(result.crashHealth).toBe(88);
  expect(result.movingStatus).toBe('driving');
  expect(result.stoppedStatus).toBe('delivered');
  expect(result.outsideStatus).toBe('driving');
  expect(result.disabledHealth).toBe(100);
});

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
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1300);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#speed')).not.toHaveText('000');
  await page.screenshot({path:'art/qa/delivery-drive.png'});
  await page.keyboard.press('KeyC');
  await page.screenshot({path:'art/qa/cockpit.png'});
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#mainMenuButton').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
});

for(const viewport of [{width:390,height:844},{width:844,height:390},{width:820,height:1180}]) {
  test(`mobile menu and delivery ${viewport.width}x${viewport.height}`,async ({browser}) => {
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

test('delivery arrival, pause timer, receipt, retry, free drive',async ({page}) => {
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?qa');
  await page.locator('#startButton').click();
  if(await page.locator('#tutorial').isVisible())await page.locator('#tutorialSkipButton').click();
  await page.keyboard.press('Escape');
  const elapsed = await page.evaluate(()=>(window as any).__mistlineQA.delivery.elapsed);
  await page.waitForTimeout(400);
  expect(await page.evaluate(()=>(window as any).__mistlineQA.delivery.elapsed)).toBe(elapsed);
  await page.locator('#resumeButton').click();
  await page.evaluate(()=>{
    const {simulation,delivery,view}=(window as any).__mistlineQA;
    Object.assign(simulation.player,{x:delivery.targetX,z:delivery.targetZ,forwardSpeed:0,lateralSpeed:0,yawRate:0});
    delivery.reset();view.resetCamera();
  });
  await page.screenshot({path:'art/qa/delivery-bay.png'});
  // Advance simulation time explicitly: software WebGL can render below 1fps.
  // Unit tests above separately prove moving / outside-bay states cannot deliver.
  await page.evaluate(()=>{
    const {simulation,delivery}=(window as any).__mistlineQA;
    for(let i=0;i<50;i++)delivery.update(1/30,simulation.player);
  });
  await expect(page.locator('#deliveryResult')).toBeVisible({timeout:15000});
  await page.screenshot({path:'art/qa/delivery-receipt.png'});
  await page.locator('#deliveryRetry').click();
  await expect(page.locator('#deliveryResult')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__mistlineQA.delivery.integrity)).toBe(100);
  await page.keyboard.press('Escape');
  await page.locator('#mainMenuButton').click();
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator('#deliveryBrief')).toBeHidden();
  await page.locator('#startButton').click();
  await expect(page.locator('#deliveryHud')).toBeHidden();
  expect(errors).toEqual([]);
});
