#pragma once

#include <Arduino.h>

// A self-contained setup/admin page. Dynamic readings are loaded from JSON APIs.
static const char PORTAL_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Smart Stock Bin Setup</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#17212b;background:#eef3f7}
    body{margin:0;padding:18px}.wrap{max-width:680px;margin:auto}.card{background:#fff;border-radius:16px;padding:18px;margin:12px 0;box-shadow:0 3px 18px #16324a18}
    h1{font-size:1.65rem;margin:.2rem 0}h2{font-size:1.05rem;margin:0 0 12px}.muted{color:#607080}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    label{font-weight:650;display:block;margin:10px 0 5px}input,select,button{box-sizing:border-box;width:100%;font:inherit;padding:13px;border-radius:10px;border:1px solid #b7c4cf}
    button{border:0;background:#1266d6;color:#fff;font-weight:750;margin-top:12px;cursor:pointer}.secondary{background:#44576a}.danger{background:#b42318}.ok{color:#087443}.bad{color:#b42318}
    .reading{font-size:2rem;font-variant-numeric:tabular-nums}.pill{display:inline-block;border-radius:99px;padding:5px 9px;background:#e6edf5}.full{grid-column:1/-1}
    details{margin-top:14px;padding:12px;border:1px solid #d5dee6;border-radius:10px}summary{font-weight:700;cursor:pointer}
    @media(max-width:520px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body><div class="wrap">
  <div class="card"><h1>Smart Stock Bin</h1><div id="identity" class="muted">Loading device identity…</div><div class="muted">MQTT: <span id="mqttState">checking…</span></div><p><span id="state" class="pill">Loading</span></p></div>
  <div class="card"><h2>Load cell setup</h2><div class="reading"><span id="weight">—</span> <span id="weightUnit">g</span></div>
    <div class="muted">Raw ADC: <span id="raw">—</span> · Tare offset: <span id="tareOffset">—</span> · Net: <span id="netRaw">—</span> counts</div>
    <div class="muted">Filtered net: <span id="filteredNet">collecting…</span> · Samples: <span id="filterSamples">0/30</span> · Noise: <span id="noise">—</span> · <span id="stability">settling</span></div>
    <div class="muted">Estimated quantity: <span id="qty">—</span></div>
    <button id="tareBtn" type="button" class="secondary" onclick="tare()">1. Tare empty bin</button><div id="tareMsg" class="muted"></div>
    <label for="knownWeight">Known calibration mass (grams)</label>
    <input id="knownWeight" type="number" min="0.01" step="0.01" value="1000" inputmode="decimal">
    <button id="calibrateBtn" type="button" onclick="calibrate()">2. Calibrate with mass fitted</button><div id="calibrateMsg" class="muted"></div>
    <p class="muted">Tare with the bin empty, then add the known mass and calibrate. The bin, platform and mass together must not exceed the load cell's rated capacity.</p>
  </div>
  <div class="card"><h2>Connect to Wi-Fi</h2>
    <form id="configForm"><label for="ssid">Wi-Fi network</label><div class="grid"><select id="ssid" name="ssid" required><option value="">Scan to choose…</option></select><button type="button" class="secondary" onclick="scan()" style="margin-top:0">Scan</button></div>
      <label for="password">Wi-Fi password</label><input id="password" name="password" type="password" autocomplete="new-password" placeholder="Leave blank for an open network">
      <p class="muted">The bin discovers the SmartWall station automatically after joining the same local network.</p>
      <details><summary>Advanced connection settings</summary>
        <label for="mqttHost">MQTT broker host or IP (optional fallback)</label><input id="mqttHost" name="mqttHost" placeholder="Discovered automatically">
        <label for="mqttPort">MQTT port</label><input id="mqttPort" name="mqttPort" type="number" min="1" max="65535" value="1883">
        <label for="mqttUsername">MQTT username</label><input id="mqttUsername" name="mqttUsername" autocomplete="off" placeholder="Only when required by the wall">
        <label for="mqttPassword">MQTT password</label><input id="mqttPassword" name="mqttPassword" type="password" autocomplete="new-password" placeholder="Only when required by the wall">
        <label for="otaPassword">OTA update password (optional)</label><input id="otaPassword" name="otaPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Blank keeps the existing password">
      </details>
      <button type="submit">Save & Connect</button><div id="saveMsg" class="muted"></div>
    </form>
  </div>
  <div class="card"><h2>Maintenance</h2><div class="grid"><button type="button" class="secondary" onclick="findBin()">Test Find light</button><button type="button" class="danger" onclick="resetConfig()">Clear Wi-Fi & restart setup</button></div>
    <label for="firmwareManifest">Signed firmware manifest (.json)</label><input id="firmwareManifest" type="file" accept=".json">
    <label for="firmwareFile">Firmware update (.bin)</label><input id="firmwareFile" type="file" accept=".bin,application/octet-stream">
    <label for="otaUploadPassword">OTA password (if configured)</label><input id="otaUploadPassword" type="password" autocomplete="current-password" placeholder="Leave blank if no OTA password was set">
    <button id="otaBtn" type="button" onclick="uploadFirmware()">Install firmware update</button><div id="otaMsg" class="muted"></div>
    <p class="muted">OTA is available only on normal Wi-Fi, never in setup/AP mode. Keep the bin powered during installation. A successful update restarts automatically and preserves configuration.</p>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
async function api(url,options){const r=await fetch(url,options);let d={};try{d=await r.json()}catch(e){}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
async function status(){try{const d=await api('/api/status');$('identity').textContent=d.binId+' · firmware '+d.firmware+' · '+(d.ip||'no IP');$('state').textContent=d.state;$('mqttState').textContent=d.mqttConnected?'connected':(d.mqttDiscovered?(d.mqttAuthenticationRequired?'credentials required':'wall found; connecting'):'discovering wall');if(d.weightValid){$('weight').textContent=d.weightGrams.toFixed(2);$('weightUnit').textContent='g'}else if(d.filterReady&&d.hasTare){$('weight').textContent=d.filteredNetRaw.toFixed(1);$('weightUnit').textContent='filtered counts'}else if(d.rawValid&&d.hasTare){$('weight').textContent=d.netRaw;$('weightUnit').textContent='net counts'}else{$('weight').textContent='Not calibrated';$('weightUnit').textContent=''}$('raw').textContent=d.rawValid?d.raw:'unavailable';$('tareOffset').textContent=d.hasTare?d.tareOffset:'not set';$('netRaw').textContent=d.rawValid&&d.hasTare?d.netRaw:'—';$('filteredNet').textContent=d.filterReady?d.filteredNetRaw.toFixed(1):'collecting…';$('filterSamples').textContent=d.filterSamples+'/'+d.filterWindowSamples;$('noise').textContent=d.filterReady?d.noiseCounts.toFixed(1)+' counts':'—';$('stability').textContent=d.filterReady?(d.measurementStable?'stable':'settling'):'collecting';$('stability').className=d.filterReady&&d.measurementStable?'ok':'muted';$('qty').textContent=d.estimatedQuantity===null?'—':d.estimatedQuantity;if(d.mqttHost&&!$('mqttHost').value)$('mqttHost').value=d.mqttHost;if(d.mqttPort)$('mqttPort').value=d.mqttPort}catch(e){$('state').textContent=e.message}}
async function scan(){const s=$('ssid');s.innerHTML='<option>Scanning…</option>';try{const d=await api('/api/networks');s.innerHTML='<option value="">Choose a network…</option>';d.networks.forEach(n=>{const o=document.createElement('option');o.value=n.ssid;o.textContent=n.ssid+' ('+n.rssi+' dBm)'+(n.secure?' 🔒':'');s.appendChild(o)})}catch(e){s.innerHTML='<option value="">Scan failed</option>'}}
async function tare(){const b=$('tareBtn');b.disabled=true;b.textContent='Taring…';$('tareMsg').className='muted';$('tareMsg').textContent='Taking 50 readings over about 5 seconds… keep the empty bin still.';try{const d=await api('/api/tare',{method:'POST'});$('tareMsg').className='ok';$('tareMsg').textContent='Tare saved. Offset: '+d.offset;await status()}catch(e){$('tareMsg').className='bad';$('tareMsg').textContent='Tare failed: '+e.message}finally{b.disabled=false;b.textContent='1. Tare empty bin'}}
async function calibrate(){const grams=parseFloat($('knownWeight').value);if(!Number.isFinite(grams)||grams<=0){$('calibrateMsg').className='bad';$('calibrateMsg').textContent='Enter a positive known mass in grams.';return}const b=$('calibrateBtn');b.disabled=true;b.textContent='Calibrating…';$('calibrateMsg').className='muted';$('calibrateMsg').textContent='Reading the fitted '+grams+' g mass… keep it still.';try{const d=await api('/api/calibrate',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({knownWeightGrams:String(grams)})});$('calibrateMsg').className='ok';$('calibrateMsg').textContent='Calibration saved. Scale: '+Number(d.scaleCountsPerGram).toFixed(4)+' counts/g';await status()}catch(e){$('calibrateMsg').className='bad';$('calibrateMsg').textContent='Calibration failed: '+e.message}finally{b.disabled=false;b.textContent='2. Calibrate with mass fitted'}}
async function findBin(){try{await api('/api/find',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'active=1&timeout=10'})}catch(e){alert(e.message)}}
async function resetConfig(){if(!confirm('Clear stored Wi-Fi credentials and restart in Setup Mode?'))return;try{await api('/api/factory-reset',{method:'POST'});$('state').textContent='Restarting…'}catch(e){alert(e.message)}}
async function uploadFirmware(){const file=$('firmwareFile').files[0],password=$('otaUploadPassword').value,b=$('otaBtn');if(!file||!$('firmwareManifest').files[0]){$('otaMsg').className='bad';$('otaMsg').textContent='Choose the signed .json manifest and matching .bin file.';return}b.disabled=true;b.textContent='Uploading…';$('otaMsg').className='muted';$('otaMsg').textContent='Uploading '+file.name+'; keep the bin powered.';const body=new FormData();body.append('firmware',file,file.name);try{const r=await fetch('/api/ota',{method:'POST',headers:{'X-OTA-Password':password,'X-Firmware-Manifest':JSON.stringify(JSON.parse(await $('firmwareManifest').files[0].text()))},body});let d={};try{d=await r.json()}catch(e){}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));$('otaMsg').className='ok';$('otaMsg').textContent=d.message||'Installed; restarting…'}catch(e){$('otaMsg').className='bad';$('otaMsg').textContent='Update failed: '+e.message;b.disabled=false;b.textContent='Install firmware update'}}
$('configForm').addEventListener('submit',async e=>{e.preventDefault();$('saveMsg').textContent='Saving…';try{const d=await api('/api/config',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(e.target))});$('saveMsg').textContent=d.message||'Saved. Device is restarting…'}catch(err){$('saveMsg').textContent=err.message}});
status();scan();setInterval(status,1000);
</script></body></html>
)HTML";
