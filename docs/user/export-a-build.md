---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: export-a-build
---

# Export a build from Factorio

Use the sidecar mod to copy a build from Factorio to the clock generator site.

## Before you start

- You have Factorio 2.1.
- The mod **Clock Generator Sidecar** is installed and on. To install it, use the **Mods** menu of the game.
- The build is assembled in the game, and each machine has a recipe.
- The belts and chests that the inserters use have items on them or in them. The sidecar exports an empty belt only
  if each inserter that puts items on it takes them from a machine and moves one item that the machine makes. It
  exports an empty chest only if the items that go in and out show the item that it holds.

## Procedure

1. Press **Alt+E**, or click the **Clock Generator Sidecar** shortcut.

   The selection tool is in your hand.

2. Drag to select an area that contains one copy of the build. Include all of its machines, inserters, belts, chests
   and mining drills. If a belt goes into a loader, include the loader and the chest that it fills.

   The **Clock Generator Sidecar** window opens. It shows the number of entities and the suggested target.

3. Read the window. If it shows inserters or mining drills that are not in the export, read the cause for each one.
   Correct the build, then do step 2 again.

4. Click **Export**.

   The **Export your build for the Clock Generator** window opens. The text in it is selected.

5. Press **Ctrl+C**.

   If you clicked in the window and the text is not selected, click **Select all**, then press **Ctrl+C**.

6. On the clock generator site, click **Paste from Factorio**.

   The **Confirm Import from Factorio** dialog opens.

   If your browser does not let the site read the clipboard, the **Paste from Factorio** dialog opens. Paste the text
   into **Paste the export here**, then click **Continue**.

7. Make sure that each part you want is selected. Then click **Import Selected**.

## Result

The build is on the site. If the site had no setpoint before, the setpoint is the suggested target: the
product of the build at the maximum rate of its machines. If its output belt or a different part of the build cannot
take that rate, the setpoint is the maximum that the build can hold, and the **Confirm Import from Factorio** dialog shows the limit. At the
maximum rate, the clock has no time for recovery.
To give the clock time for recovery, decrease the rate in **Setpoint**.

## Related information

- [Data in a sidecar export](sidecar-export-contents.md)
