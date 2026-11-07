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
- The belts and chests that the inserters use have items on them or in them. The sidecar does not export an empty belt
  or an empty chest.

## Procedure

1. Press **Alt+E**, or click the **Clock Generator Sidecar** shortcut.

   The selection tool is in your hand.

2. Drag to select an area that contains one copy of the build. Include all of its machines, inserters, belts, chests
   and mining drills.

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
product of the build at the maximum rate of its machines. At the maximum rate, the clock has no time for recovery.
To give the clock time for recovery, decrease the rate in **Setpoint**.

## Related information

- [Data in a sidecar export](sidecar-export-contents.md)
