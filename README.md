# CFB27 Playoff Bracket Tool

This tool lets you build your own custom playoff bracket in your College
Football 27 dynasty — pick your own teams and seeds instead of only using
whatever the game gives you.

## ⚠️ Step 0: Make a backup copy of your save first

Before you touch anything, **copy your save file somewhere safe.**

This tool never changes your original file — every time you click a
button that saves something, it makes a brand new file instead. But
things can still go wrong (wrong button clicked, wrong file picked), and
you really don't want to lose your whole dynasty over a mistake. Just
copy the file. Takes 10 seconds. Do it now.

## How to open it

1. Unzip this folder wherever you want.
2. Double-click `CFB27 Playoff Editor.exe`.
3. Windows might show a scary blue screen that says "Windows protected
   your PC." **This is normal** — it just means this program isn't from
   a big company, not that anything's actually wrong. Click **More info**,
   then click **Run anyway**.

## Flipping the switch for a user-created coach

After you load your save file, a popup might show up warning you about a
known bug — but only if it actually applies to you. If your coach isn't
at risk, you won't see anything at all. Here's what it's about, in plain
terms, in case you do see it:

**The problem:** if you ever retire your own coach (the one you created
and are currently playing as), the game can **delete that coach** and
lock you out of your own team. You won't be able to pick that team to
play as anymore.

**The fix:** click the button in the popup. It flips one setting on
your coach so this can't happen. In testing so far, this hasn't changed
how a coach looks, plays, or performs — but that's based on limited
testing, not a promise about every possible long-term effect. You'll
pick where to save it, and it makes you a new, protected copy — your
original file is never touched.

**Good to know: this can pop up again later, and that's normal.** It
checks your coach fresh every time you load a save. If you create a
brand new coach down the road, you'll see this popup again the next
time you load with them — that's not a bug repeating, it's just doing
its job again for the new coach.

If you don't want to deal with it right now, click "Skip for now" — you
can come back to it later, there's no rush unless you're about to retire
a coach.

## If your dynasty has different conferences than normal

**Best time to use the Conferences tool: Week 1 of Bowl Season** — right
after Conference Championship games are actually played, but before you
go build your bracket. Championship games need to already have real
results for the tool to correctly figure out who won each conference. Too
early (championships not played yet) and it can't crown anyone; the
Conferences tool's detection and champion-crowning both depend on this
timing, same as the bracket-building steps below.

This tool has a built-in list of which team belongs to which conference.
If you've moved teams around in your dynasty (realignment), that list
might be wrong for you, which can mess up how teams qualify for the
bracket.

**You'll know this is happening if** you see a warning message about a
conference not matching.

**Easiest fix:** in the tool's Conferences section, there's a button
that says **"Detect conferences from this save's schedule."** Click it —
it reads your actual save and figures out the real conferences for you.
Double check the result looks right, then save it.

**If you want to do it by hand instead:** there's a file called
`teamConferenceOverrides.json` next to the .exe. Open it and just list
the teams that changed, like this:

```json
{
  "Boise State": "Big 12",
  "Memphis": "SEC"
}
```

Only list teams that are different from normal — everything else stays
default. Check `teamConferenceOverrides.EXAMPLE.txt` for the full list
of conference names you're allowed to use. Restart the app after you
save your changes.

## How to use the tool

- You build a bracket (pick which teams play each other, and in what
  order) using the tool.
- You click a button, and it makes a **new save file** with your bracket
  built in.
- You load that new file in the actual game and keep playing.

That's the whole loop. The tricky part is **timing** — see below.

### Timing matters — a lot

You can't just build your bracket whenever you feel like it. The game
only lets you set things up at specific moments in your season. If you
do it too early or too late, it won't work right.

Pick your bracket size below and follow those exact steps.

#### If you're doing a 4-team bracket

1. Play/sim through Conference Championships, then Bowl Week 1 (Round 1),
   then Bowl Week 2 (Quarterfinals).
2. **Stop at Bowl Week 3** — before the Semifinal games.
3. Open the tool, load your save, pick your 4 teams, click **Apply & Save**.
4. **If your own team is one of the 4**, see "Retiring and rehiring your
   coach" below.
5. Load the new file and keep playing. The Championship advances
   automatically after the Semifinals.

#### If you're doing an 8-team bracket

1. Play/sim through Conference Championships AND Bowl Week 1 (Round 1).
2. **Stop at Bowl Week 2** — before the Quarterfinal games. The
   Quarterfinals are the 4 NY6 bowls: Sugar, Fiesta, Rose, and Peach.
3. Build your 8 teams in the tool, **Apply & Save**.
4. **If your own team is one of the 8**, see "Retiring and rehiring your
   coach" below.
5. Load the new file and keep playing — Semis and Championship advance
   automatically.

#### If you're doing a 16-team bracket (this one takes two visits to the tool)

The game only has room for 4 "real" bracket games in Round 1. To fit 8
games (16 teams), the tool borrows 4 regular bowl games and quietly
turns them into extra Round 1 games. The game doesn't know it's part of
your bracket, so you have to come back a second time to set up Round 2
yourself.

**First visit — set up Round 1:**
1. Play through Conference Championships.
2. **Stop before Bowl Week starts** — no bowls played yet, including the
   borrowed ones.
3. Build your 16 teams in the tool, **Apply & Save**.
4. **If your own team is one of the 16**, see "Retiring and rehiring your
   coach" below — this is visit #1 of 2 for that step.
5. Load that file and play all 8 Round 1 games. Four will look like
   normal bracket games. The other four will just look like regular
   bowl games named:
   - Boca Raton Bowl
   - New Orleans Bowl
   - Cure Bowl
   - Gasparilla Bowl

   The tool will tell you exactly which teams are in which bowl when you
   build the bracket, so you know what to look for.

**Second visit — set up Round 2 (Quarterfinals):**
1. Once all 8 Round 1 games are done, open the tool again.
2. Load the save from *after* you played those games (a different file
   than before).
3. Click **Check Round 1 results** — it looks at who won and sets up the
   Quarterfinals for you automatically. **Double check it got the
   winners right** before moving on — if something looks wrong, fix it
   with the dropdown menus.
4. Click **Apply Round 2 & Save**.
5. **If your own team survived into Round 2**, see "Retiring and
   rehiring your coach" below again — this is visit #2 of 2. Yes, even
   if you already did it after Round 1 — this is specifically because
   of how the game hard-codes byes between these two rounds. After this
   second time, everything advances naturally on its own.
6. Load that file and keep playing — everything from here on happens on
   its own.

#### If you're doing a 2-team bracket (Championship game only)

1. Play all the way to the National Championship.
2. **Stop before playing it.**
3. Pick your 2 teams in the tool, **Apply & Save**.
4. **If your own team is one of the 2**, see "Retiring and rehiring your
   coach" below.
5. Load the file and play the Championship. That's the last game of the
   season, so there's nothing left to automate after this.

### A couple of things the tool does automatically (you don't need to do anything, just know it's happening)

- **If a team in your bracket was already scheduled in some random bowl
  game**, the tool automatically pulls them out and puts in a
  substitute team instead — so nobody's double-booked. You'll see lines
  in the log like "Dummy swap" when this happens. Totally normal, no
  action needed from you.

### Always double check in-game after applying

After every Apply, load the new save and actually look at the bracket
in-game before you keep playing — confirm the right teams landed in the
right spots. The tool tells you what it did in its own log, but that log
is just what the tool *thinks* happened — the real check is what the
game itself shows you.

This matters more than it might sound like. We've occasionally seen
cases where something displayed in the tool didn't match what was
actually in the save, even though the underlying data turned out to be
correct after checking carefully — so a quick look in-game is the
cheapest way to catch anything unexpected before it affects your season.

## Retiring and rehiring your coach (if your team is in the bracket)

**This only matters if YOUR team is one of the teams in the bracket you
just built.** If your team isn't in this particular bracket, skip this
entirely.

After Applying, your own team's "Play Game" button can show the wrong
opponent, or your team can look like it's missing from the Members tab.
This is **not caused by this tool** — it's a separate issue on the
game's side. Nothing is actually broken when this happens; your save
and your data are fine, it's just the game's screen showing you
outdated information.

**The fix for the retire/rehire dance itself:** there's a full
step-by-step guide with pictures posted in the Discord — **"User
Created Coach Retirement Guide"**. Follow that guide's steps in order —
it looks long, but that's mostly it explaining *why* each step matters.
Once you've done it once, it's a few minutes.

The coach-safety part specifically (protecting a created coach before
retiring them) is something you've **already got** just by using this
tool — that's the popup described above. The guide also mentions a
separate standalone tool called "Fix Coach Flag" (a `.bat` file), but
that's only there for people who want just that one fix *without*
using this whole bracket editor. If you're reading this README, you
don't need it — skip straight to the guide's actual retire/rehire
steps.

## This tool checks itself for you

Every time you load a save, the tool quietly double-checks that the game
hasn't changed in a way that would break it — things like making sure
the internal parts it reads and writes still look the way they did when
this tool was built.

**You won't see anything if everything's fine** — this check is silent
and automatic, no button to click.

**If you ever see a red warning box saying something like "This save
doesn't match what this tool expects"** — that means College Football 27
has probably been updated since this tool was built, in a way that could
make it read or write the wrong information without any other obvious
sign something's wrong. If you see this warning:

- **Don't trust the tool's results** until this is sorted out — the
  numbers or teams it shows you might be wrong.
- Check the Discord to see if anyone's aware of the update and whether
  there's a newer version of this tool, or a different tool, that's been
  updated to match.
- This tool may not get updated to fix this if it ever happens — treat
  the warning as a sign to look for an alternative rather than assume a
  fix is coming.

## What's new in this update

**Fixed: a game you actually played could show up as still needing to be
played.** After Applying a bracket, playing one of the games live could
finish normally in-game but then still show up as unplayed afterward,
with no score and no way to move on. The tool used to reset a few status
fields on every game it touched, and that turned out to be exactly what
caused this. It no longer touches those fields at all — it only swaps
the teams and updates the rankings. If a game you didn't personally play
gets auto-simmed instead, it may briefly show a leftover placeholder
score until the game actually processes it, which is cosmetic and
resolves itself; a game you actually play always finalizes correctly.

**Fixed: the coach-safety popup was showing up every single time, even
when nothing was actually at risk.** It's now scoped correctly - it only
appears when a coach genuinely needs protecting, not just because you
happen to be controlling a team (which is normal and fine on its own).

**Fixed a rare file-corruption bug in the writing step itself.** In some
saves, a coincidental quirk in the file's own bytes could cause the tool
to miscalculate where to start writing, corrupting the output file. The
tool now also double-checks that whatever it just wrote can actually be
opened again, and will refuse to hand you a broken file rather than fail
silently.

**Your bracket's rankings now show up correctly everywhere in the game.**
Before this update, the tool's own rankings (the ones used to seed your
bracket) and the game's actual Top 25 / CFP rankings (shown on bowl and
schedule screens) could disagree — a team seeded 7th in your bracket
might still show up ranked 3rd on the game's own schedule screen, because
the game never knew about your bracket. Now, every time you Apply, your
bracket's actual seed numbers get written into the game's own ranking
display too. What you build in the tool is what you'll see in-game.

**Fixed: a conference's champion could occasionally not get "crowned."**
If you use the Conferences tool, there was a bug where a conference's
actual champion (the team that really won the title game) could get
missed if their overall record wasn't the best in the conference — which
can genuinely happen. This is fixed now.

**The tool now double-checks itself after every Apply.** It verifies
nothing outside the specific week(s) it's supposed to touch actually
changed. If it ever detects that something it shouldn't have touched got
changed anyway, it will refuse to hand you that file and show a clear
"VERIFICATION FAILED" message in the Log instead of a silently broken
save. If you ever see this message, don't use that file — post about it
in the Discord.

**Clearer error if you Apply too early.** If you point the tool at a
save from before the previous round has actually been played, it now
stops right away and tells you plainly what happened, instead of
building a bracket with a missing team in it. If you see this, just sim
to the correct week (see Timing above), save, and try again with that
save file.

## Something went wrong / found a bug?

Post about it in the Discord. Screenshots really help — especially if
you can show what the tool's own Log panel said it did, next to what
actually happened in-game.
