# WebOsu 2.0!

Osu! is a rhythm game where you click circles on the screen, following the rhythm of the music.


Powered by [PixiJS](https://www.pixijs.com), [Sayobot](https://osu.sayobot.cn). Massive credit to the giga-chad that made [the original WebOsu!](https://github.com/111116/webosu) as this is just a fork of that, with minor changes + continuation of updates.

**(under development)**

Note: This is an unofficial implementation of [osu!](https://osu.ppy.sh). Scoring and judgement rules can differ from that of official osu!. Some music might not be perfectly syncing (still being tested). Modes other than osu! (std) are unsupported.

## Screenshots

game in action:

![webpage](screenshots/clip3.gif)

## Hosting

Set up a web server with root directory located where `index.html` is in.

To host a separate live score, redirect send/fetch api requests to localhost:3000/3001 respectively, and change the api url in `index.html` and `scripts/overlay/score.js` accordingly. Then run:

```bash
nohup node api.js &
```

## Todos

- audio offset
- input offset
- beatmap hitsounds
- supported mods: Easy, Daycore, Hard Rock, Hidden, Nightcore, Autoplay.

## License Notes

Some media files are copyrighted by [ppy](https://github.com/ppy/) and other people. Check their respective license before you use them.
