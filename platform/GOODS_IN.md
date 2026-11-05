# Goods in: barcode and QR intake

Use **Goods in** in the local physical wall frontend. A USB scanner configured
as a keyboard is detected automatically while the local browser window is active.
A fast scan opens Goods in from any screen. Enter/Tab suffixes are supported;
suffix-free bursts of at least six characters submit after a short pause.
Other form fields are excluded from global automatic detection. The Goods in
scan field also resolves typed or pasted text after a 700 ms pause, irrespective
of scanner speed, and accepts Enter or Tab. Keep that field focused if your
scanner is not recognized globally.
You can also type or paste a code and select Resolve scan.
The online company portal has separate, read-only Goods in, Supplier items and
Scan audit views; physical bin commands run at the local station.

1. Scan the product label. Existing mappings resolve immediately. A mapped
   component with exactly one assigned online bin automatically starts guided
   restocking after the backend checks the scale and firmware acknowledgements.
   Multiple assigned bins or an unassigned component require choosing a bin.
   Unknown codes show **New code detected — please map this product**. Known supplier
   codes, product URLs, structured supplier JSON and checksum-valid GTINs are
   recognized. Accu, RS, Farnell, DigiKey and Mouser have parser support.
2. A verified catalogue match can create a component automatically. Recognized
   official product URLs can also resolve using an unambiguous Product JSON-LD
   record with a matching SKU. Unsupported, protected or ambiguous pages fall
   back to operator confirmation. Unfamiliar supplier codes require confirmation;
   proprietary bag label formats still need actual label samples for validation.
3. Confirm an unfamiliar product by selecting an existing component or naming a
   new one. Its raw identifier is retained and learned for later scans. Courier
   and tracking labels are rejected. Multiple supplier items and identifiers can
   refer to one component. Conflicts require an explicit correction and reason;
   correcting a mapping does not move existing physical stock.
4. Select an online bin with a fresh, stable scale reading. Unassigned bins and
   components without a learned weight must start empty and tared. Assignment
   and green restock guidance proceed only after firmware acknowledgements.
5. Add stock and wait for a stable reading. For a first fill, confirm the actual
   piece count to learn weight from the scale. Supplier weight metadata remains
   an estimate. Later calibrated fills infer the added count; uncertain readings
   require confirmation. A receipt expires after ten minutes. Retries reuse the
   receipt and do not create a second stock movement.

The advanced catalogue import accepts a JSON array and requires explicit
verification. Example (replace example metadata with checked supplier data):

```json
[{"supplier":"Accu","partNumber":"HSH-M5-20-A2","name":"M5 screw","packageQuantity":20,"gtins":[]}]
```

Scanning and learned mappings work locally without internet access. Receipts,
supplier items, identifiers, catalogue entries and audit records queue for cloud
synchronization. Other walls in the same company download mappings on subsequent
sync cycles; each wall retains its own bin inventory and scale calibration.
Existing local mappings win over conflicting downloaded identities, with a
conflict audit for review. A wall credential cannot access another company's
catalogue. Local audit actor `operator_station` reflects the current station
workflow; it is separate from online user login.

The online portal presents recent receipt/audit history and all synchronized
supplier metadata. The database retains the complete history. ELEGOO firmware
is unchanged; this workflow reuses its existing label and find commands.

Local validation uses isolated SQLite databases:

```sh
cd platform
npm run typecheck
node --import tsx --test backend/test/goods-in.test.ts
```

A physical acceptance check is still needed with your actual scanner, product
labels and stocked bin: first fill, repeat fill, cancellation and network loss.
