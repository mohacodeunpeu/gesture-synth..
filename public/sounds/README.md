# Sounds

**No audio files are bundled with MOHA MOTION.** Every built-in sound (MEMES, DRUMS, FX, VOICES)
is synthesised by code at runtime — see `src/audio/sfx/`.

## Using your own sounds

Import them **inside the app** (button *Importer un son*, drag & drop on a pad, or click an empty
pad). They are stored locally in your browser (IndexedDB) and never uploaded or committed.

## If you want to ship sounds with your own build

Only put files here that you have the right to redistribute:

- sounds you recorded or made yourself,
- CC0 / public-domain sounds,
- sounds whose licence explicitly allows redistribution (keep the licence next to the file).

"Found on the internet" does **not** mean free to use. Meme clips, film/TV/game audio and music
samples are usually copyrighted — keep those as local imports only.

The repository's `.gitignore` ignores audio files in this folder on purpose, so nothing is
published by accident.
