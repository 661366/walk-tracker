# Walk Tracker

A minimal door-knocking walk tracker (Leaflet + OpenStreetMap, PWA). This repo holds **only the app shell** - no address data.
Walk lists are loaded on the phone with **Import walk list** (CSV) and results stay in the phone's localStorage until exported with **Export CSV**.

Import CSV columns (minimum): `lead_id, date, route_seq, walk, address, zip, latitude, longitude` (optional `neighborhood`).
Imports merge by `lead_id` and never erase saved statuses/notes.
