---
$schema: urn:oasis:names:tc:dita:xsd:task.xsd
id: install-the-sidecar-from-a-local-zip-file
---

# Install the sidecar from a local zip file

Make the zip file of the sidecar from your copy of the repository with `clock-generator-sidecar/build.sh`. Then install
the zip file in Factorio.

## Before you start

- You have a Bash shell and the `zip` command.
- Factorio started on this computer one time or more. Thus its mods folder is there.

## Procedure

1. Go to the root folder of the repository.

2. Make the zip file and install it.

   ```bash
   clock-generator-sidecar/build.sh --install
   ```

   On Windows, `--install` stops with an error. Type the command without `--install`.

   `build.sh` makes the zip file `clock-generator-sidecar/clock-generator-sidecar_<version>.zip`, with the version of
   `clock-generator-sidecar/info.json`. On Linux and macOS, it removes the previous zip files of the mod from the mods
   folder. Then it copies the new zip file into the folder:

   - Linux: `~/.factorio/mods/`
   - macOS: `~/Library/Application Support/factorio/mods/`

   If the mods folder is not there, the script stops with the message "Mods folder not found".

3. On Windows only, copy the zip file into `%APPDATA%\Factorio\mods\`. Remove the previous zip files of the mod from
   that folder.

4. Start Factorio. In the **Mods** menu, make sure that **Clock Generator Sidecar** is on.

## Result

Factorio uses the sidecar of your copy of the repository.

## Related information

- [Export a build from Factorio](../user/export-a-build.md)
