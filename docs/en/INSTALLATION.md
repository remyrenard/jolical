[🇫🇷 Français](../INSTALLATION.md) · 🇬🇧 English

# Installation and administration

All commands are run on the server, from the project folder (the one that contains `docker-compose.yml`).

---

## 1. Installation

### On the Nextcloud side

1. Preferably create a **dedicated user** (for example `jolical`) and share with it, with write access, the calendars and task lists to display. Jolical then only has access to what you share with it.
2. Signed in as this user: **Personal settings > Security > Create new app password**.

### On the server side

1. Create `config.secret` from the template:

   ```
   cp config.secret.example config.secret
   ```
2. Generate the **hash of your Jolical password**:  
   Your password is never stored, only its hash (a one-way calculation) is.  
   (The password is asked twice and is not displayed.)

   ```
   docker compose run --rm jolical node hash.js
   ```

   Copy the `APP_PASSWORD_HASH=scrypt:…` line it prints for the next step.
3. Fill in `config.secret`:

   ```
   nano config.secret
   ```

   ```
   NC_URL=https://cloud.example.com
   NC_USER=jolical
   NC_APP_PASSWORD=xxxxx-xxxxx-xxxxx-xxxxx-xxxxx
   APP_PASSWORD_HASH=scrypt:…   (generated in the previous step)
   ```

   `NC_URL` accepts a sub-path (`https://example.com/nextcloud`).
4. Give the file to the container user (1000) and protect it:

   ```
   sudo chown 1000:1000 config.secret
   chmod 600 config.secret
   ```

   Without this owner, Jolical does not start and says so in the logs.
5. Start:

   ```
   docker compose up -d --build
   ```
6. Set up your HTTPS proxy to `http://127.0.0.1:6006`, or direct access on the local network (see section 7).

The `.env` file (optional, next to `docker-compose.yml`) may contain:

| Variable         | Purpose                                                          | Default        |
|------------------|------------------------------------------------------------------|----------------|
| `LOG_LEVEL`      | `info` or `debug`                                                | `info`         |
| `JOLICAL_BIND`   | address on which port 6006 is open (section 7)                   | `127.0.0.1`    |
| `JOLICAL_VOLUME` | name of the Docker data volume (to reuse an existing volume)     | `jolical-data` |
| `TZ`             | container time zone (logs)                                       | `Europe/Paris` |

> ⚠️ Docker does not re-read `config.secret` on a simple restart: after each change, restart with  
> `docker compose up -d --force-recreate`.

---

## 2. Changing the Jolical password

The password is never stored: only its **hash** (a one-way calculation) is.

1. Generate the new hash (the password is asked twice and is not displayed):

   ```
   docker compose run --rm jolical node hash.js
   ```
2. Copy the `APP_PASSWORD_HASH=scrypt:…` line it prints into `config.secret`, replacing the old one.
3. Restart:

   ```
   docker compose up -d --force-recreate
   ```

All devices are then signed out and will have to enter the new password.

**Forgotten password?** There is nothing to recover: simply create a new one with the steps above.

**Tip**: a phrase of 4 or 5 random words, 8 characters minimum; the browser’s password manager then remembers it.

---

## 3. Wrong passwords: blocking and slowdown

Jolical protects itself against someone trying to guess the password by chaining attempts. Two protections work together:

**1. Blocking applies to the device that gets it wrong** (a phone, a computer…), not to everyone:  
3 errors → blocked for 5 min · 3 more → 1 h · 3 more → 24 h (then 24 h every 3 errors).  
If an unknown device keeps trying, you can still sign in from yours.

**2. The slowdown applies to everyone.** An attacker may control thousands of addresses (hacked computers, a range of IPv6 addresses): even with 3 attempts per address, that would still mean thousands per hour. If many errors occur, from all sources combined (20 or more in one hour), Jolical only accepts **one attempt every 5 seconds**, in total.

- *Why slow down rather than block everything?* A global block would be a weapon for the attacker: they would only need to make mistakes on purpose to stop you from signing in. With a slowdown, you can still sign in (at worst after a few seconds), while the attacker is limited to 720 attempts per hour: far too few to guess a password made of several words.
- The slowdown stops by itself once the errors stop (fewer than 20 over the last hour).

Devices that are already signed in are affected by neither.

To lift a block immediately:

- **from a signed-in device**: Settings > Connections > Password entry > **Unblock password entry**;
- **without a signed-in device**:

  ```
  docker compose exec jolical rm -f /data/lockout.json
  ```

---

## 4. Signing out devices

- **From Jolical**: Settings > Connections > red ✕ at the end of the device’s row, or “Sign out all devices”.
- **Without access to Jolical** (lost device, no other signed-in device):

  ```
  docker compose exec jolical rm -f /data/sessions.json
  ```

A device stays signed in for 10 days after its last visit, and 90 days at most.

---

## 5. Changing the Nextcloud app password

1. In Nextcloud, signed in as the Jolical user: Personal settings > Security > create a new app password (and revoke the old one).
2. Put it in `config.secret` (`NC_APP_PASSWORD=`).
3. `docker compose up -d --force-recreate`

If `config.secret` may have fallen into other hands (server or disk lost, stolen or hacked, backup shared by mistake…): **first** revoke this app password in Nextcloud, so that it no longer gives access to anything. Then change the Jolical password (section 2), because `config.secret` also contains its hash.

---

## 6. Themes, languages, fonts and backup

- **Themes**: one file per theme in the volume, `/data/themes/<id>.json`. Four themes are bundled (Light, Dark, Light Green, Dark Green); they are installed only once: a bundled theme that you delete does not come back.
- **Editing a theme** does not change it: a “<name> (modified)” copy is created and selected. Then, in Settings > Appearance > Theme: **Overwrite** (the copy replaces the original theme), **New** (the copy is kept under another name) or **Delete**.
- **Jolical embedded in Nextcloud (iframe)**: it has its own selected theme (initially the browser’s), which is remembered when you change it (for example, to have a theme in Nextcloud’s colours there while keeping the default theme when you open Jolical in a browser).
- **Changing the “Default” theme**: copy a theme under the name `defaut.json`, for example:

  ```
  docker compose exec jolical cp /data/themes/vert-clair.json /data/themes/defaut.json
  ```

  To go back to the original values: `docker compose exec jolical rm /data/themes/defaut.json`
- **Language**: chosen the first time you open Jolical, then in General settings > Language. To add a language or change a few texts: see [custom/texts/README.md](../../custom/texts/README.md).
- **Fonts**: put your files in `custom/fonts/`; they appear in the font lists. Check their licence: a commercial font must not be published with your files.
- **Backup**: Settings > Configuration backup > Export the configuration (general settings, external calendars, selected theme). “Import a configuration…” loads it back, on this installation or a new one.

---

## 7. Access: HTTPS proxy or local network

Port 6006 is only open on the `JOLICAL_BIND` address: **127.0.0.1 by default** (the machine itself).
Jolical can therefore only be reached through a proxy installed on this machine.

### With an HTTPS proxy (recommended)

- **Proxy installed directly on the machine**: target `http://127.0.0.1:6006`.
- **Proxy in a Docker container**: 127.0.0.1 cannot be reached from that container. Two options:
  1. put both containers on the same Docker network and target `http://jolical:8080`;
  2. or open the port on the Docker bridge address, in `.env`: `JOLICAL_BIND=172.17.0.1`, and target `http://172.17.0.1:6006`.

Jolical only trusts the proxy headers (real device address, HTTPS) when the connection comes from a private address,
which is the case for a proxy on the same machine or in Docker.

### Without a proxy, on the local network

Put the machine’s IP address on your network in `.env` (for example `JOLICAL_BIND=192.168.1.10`), then open `http://192.168.1.10:6006` from a device on the same network. Good to know:

- the connection is **not encrypted**: the password travels in clear text on the local network; keep this to a trusted network;
- browsers do not offer to **install the app** (PWA) without HTTPS;
- Jolical stays unreachable from outside, unless you open this port on your router (not recommended without HTTPS).

`JOLICAL_BIND=0.0.0.0` opens the port on every address of the machine (not recommended).

After changing `.env`: `docker compose up -d`.

**Integration into Nextcloud**:  
In Jolical, tick General settings > “Allow iframes” and enter the address of your Nextcloud.  
You can then embed Jolical directly in Nextcloud with Nextcloud’s “External sites” app.

---

## 8. Start-up check, status and logs

- Each time the image is built, Jolical checks itself (`node check.js`). If there is a problem, the build **fails** with a message, and the previous container keeps running.
- **Container status** (healthy / unhealthy): checked every minute (`/api/health`: the server responds and `/data` is writable). A Nextcloud outage does not make the container “unhealthy”: Jolical switches to offline mode.

  ```
  docker inspect --format '{{.State.Health.Status}}' jolical
  ```
- **Logs** (JSON): `docker compose logs jolical`; sign-ins: `docker compose logs jolical | grep -i connexion`. Log messages are in French.

---

## 9. Updating

```
git pull
docker compose up -d --build
```

The `jolical-data` volume (settings, themes, devices, external calendars, offline backup) is kept.
