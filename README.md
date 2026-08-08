# Ball14's CFB27 Playoff Bracket Tool

Build a custom playoff bracket in your College Football 27 dynasty — pick your own teams, seeds, and format instead of only using what the game gives you. Supports 2, 4, 8, 12, and 16-team brackets with full BCS-style ranking, conference detection, and bracket history.

---

## ⚠️ Your save is protected automatically

Every time you click Apply, the tool **backs up your original save to a Playoff folder** (inside your Saves directory) before overwriting it. You don't need to do this manually anymore — but keeping your own backup of your dynasty save somewhere safe is still a good habit.

---

## How to open it

1. Unzip this folder wherever you want.
2. Double-click `CFB27 Playoff Editor.exe`.
3. Windows may show a blue "Windows protected your PC" screen. Click **More info**, then **Run anyway**. This is normal for apps not from major publishers — nothing is wrong.

---

## The flow: three steps every season

The sidebar on the left walks you through this automatically, but here's the full picture:

### Step 1 — Conferences

**Best time: Week 1 of Bowl Season**, right after Conference Championship games are played.

The tool has a built-in list of which teams belong to which conference. If your dynasty uses a custom realignment, that list might be wrong for you — which can mess up how teams qualify for the bracket.

- Go to **Conferences** in the sidebar.
- Load your save. Conference standings and detected champions populate automatically.
- If the detected champions look wrong, click **Detect conferences from this save's schedule** and save the result. This is a one-time setup — you won't need to touch it again unless you change your realignment.
- You can also edit `teamConferenceOverrides.json` directly if you prefer:

```json
{
  "Boise State": "Big 12",
  "Memphis": "SEC"
}
```

Only list teams that differ from the defaults. See `teamConferenceOverrides.EXAMPLE.txt` for all valid conference names. Restart the app after saving changes.

---

### Step 2 — BCS Rankings

- Go to **BCS Rankings** in the sidebar.
- Rankings compute automatically when you load a save. The Top 25 shows on the left. Settings are on the right.
- Adjust any weights you want, then hit **Run BCS Rankings** to see the updated Top 25 with movement indicators (▲/▼) showing what changed.
- When you're happy with the rankings, hit **Write rankings to save** to update the in-game Top 25, or **Don't update** to skip and move on.

Rankings are used by the bracket tool to auto-fill At-Large seeds and to assign poll ranks after an Apply.

---

### Step 3 — Bracket Tool

Pick your bracket size, fill in the autobids and seeds, and apply. The sidebar tracks your progress through each sub-step.

---

## Bracket sizes and timing

### 2-team

Everything happens in one visit — Bowl Week 4. Load your save, pick your two finalists, apply. Championship game is set directly.

**BCS matchups (optional):** If you want to set the NY6 bowl matchups (the 6 games that aren't your championship), use **Apply BCS/NY6 Games Only** in Bowl Week 2 for the first four, then again in Bowl Week 3 for the remaining two. The championship itself is set and run separately in Bowl Week 4.

### 4-team

One visit — Bowl Week 3. Pick your 4 teams as two semifinal matchups. The game advances the winners to the championship automatically.

**BCS matchups (optional):** For the 4 NY6 games that aren't part of your bracket, use **Apply BCS/NY6 Games Only** in Bowl Week 2. Playoff games are set and run separately in Bowl Week 3.

### 8-team

One visit — Bowl Week 2. Pick your 8 teams. The game advances winners automatically through semis to the championship.

### 12-team (two visits)

**First visit — Bowl Week 1:**
1. Set your 12 teams (4 byes + 8 first-round matchups) and apply.
2. If your own team is in the bracket, do the retire/rehire process now (see below).
3. Play Bowl Week 1 (the 4 Round 1 games).

**Second visit — Bowl Week 2:**
1. Load the save from after Round 1 is played.
2. Pick your **Quarterfinal pairing style** first (CFP convention or true reseed), then click **Check Round 1 results**.
3. Verify the winners, review the auto-generated QF matchups, override anything if needed.
4. Click **Apply Round 2 & Save**.
5. If your team survived, do the retire/rehire process again.

**Quarterfinal pairing styles:**
- **CFP convention:** 8/9 winner plays seed 1, 7/10 plays seed 2, 6/11 plays seed 3, 5/12 plays seed 4
- **True reseed:** all 8 survivors sorted by seed, paired best vs worst working inward

### 16-team (two visits)

The game only has 4 native playoff slots for Round 1. The tool borrows 4 regular bowl games (Boca Raton, New Orleans, Cure, Gasparilla) as extra Round 1 slots.

**First visit — Bowl Week 1:**
1. Set your 16 teams and apply.
2. When prompted, choose whether to apply CFP First Round presentation (see below).
3. If your own team is in the bracket, do the retire/rehire process.
4. Play all 8 Round 1 games.

**Second visit — Bowl Week 2:**
1. Load the save from after Round 1.
2. Choose your **Quarterfinal pairing style** (reseed or bracket order), then click **Check Round 1 results**.
3. Verify winners, review auto-generated QF matchups, override if needed.
4. Click **Apply Round 2 & Save**.
5. If your team survived, do the retire/rehire process again.

**Quarterfinal pairing styles:**
- **Reseed:** best surviving seed vs worst, working inward (1v8, 2v7, 3v6, 4v5 of survivors)
- **Bracket order:** winners advance within their bracket half — QF1: 1v16 winner vs 8v9 winner; QF2: 4v13 winner vs 5v12 winner; QF3: 3v14 winner vs 6v11 winner; QF4: 2v15 winner vs 7v10 winner

---

## Championship location (optional)

On the Format tab, you can pick a specific venue for the National Championship. Choose from 20 confirmed premier neutral sites: AT&T Stadium, Allegiant Stadium, Bank of America Stadium, Caesars Superdome, Camping World Stadium, Cotton Bowl, Everbank Stadium, Ford Field, Hard Rock Stadium, Lincoln Financial Field, Lucas Oil Stadium, M&T Bank Stadium, Mercedes-Benz Stadium, MetLife Stadium, Nissan Stadium, NRG Stadium, Raymond James Stadium, Rose Bowl, SoFi Stadium, State Farm Stadium. Leave on Auto to let the game decide.

---

## CFP First Round presentation (16-team only)

When you apply a 16-team bracket, you'll be asked whether to make the 4 borrowed regular bowl games look and play like real CFP First Round games. Saying yes gives them:

- The hosting team's real home stadium instead of the bowl's neutral site
- CFP logo, jersey patch, field markings, and playoff commentary

Saying no leaves them branded as their original bowls. Either way, they function correctly as part of your bracket.

If you later build a different bracket size and this conversion is still applied, the tool asks if you want to revert those 4 bowls back to normal first.

**Known limitation:** if the hosting team shares its stadium with an NFL team (Pittsburgh/Acrisure Stadium is the confirmed case), the field markings won't show correctly there — everything else still works. This appears to be a limitation in how that stadium's art assets are built, not something fixable through the save file.

---

## Retiring and rehiring your coach

**Only relevant if YOUR team is in the bracket you just built.** Skip this if your team isn't involved.

After Applying, your own team's "Play Game" button can show the wrong opponent, or your team can appear missing from the Members tab. This is not caused by this tool — it's a known game behavior when saves are edited outside the game. Nothing is actually broken; it's just stale display information. There's no save-file fix, but the retire/rehire workaround clears it.

**Full step-by-step guide with pictures:** see **"User Created Coach Retirement Guide"** posted in the Discord.

**Important:** 12-team and 16-team brackets require this done **twice** — once after the first Apply (Round 1), and again after the second Apply (Round 2), if your team survived that far. Every other bracket size only needs it once.

The coach protection flag (preventing your created coach from being deleted on retirement) is handled automatically by this tool when you first load your save — you'll see a popup if it applies to you. Just click the button in the popup; no extra steps needed.

---

## Protecting your created coach

After you load a save, a popup may appear if your coach is at risk of being permanently deleted on retirement — a known game bug. If it shows up:

- Click the button in the popup. It flips one setting on your coach to prevent this.
- It saves a new protected copy; your original file is never touched.
- This can appear again later if you create a new coach — that's normal behavior, not a repeat bug.

If you don't see a popup, your coach is already safe.

---

## Fingerprint check

Every time you load a save, the tool quietly checks that the game's internal data format still matches what this tool was built for. If College Football 27 has been updated in a way that could cause silent errors, you'll see a red warning box. If that happens:

- Don't trust the tool's results until it's sorted out.
- Check the Discord for awareness of the update and whether a newer version is available.

No warning means everything's fine — this check is silent when it passes.

---

## BCS Rankings

The tool builds its own ranking from scratch using real game results — not the game's own unreliable rank field. The ranking engine uses RPI, Colley, Massey, Elo, SOS, and WAA computer systems plus a poll simulation, with tunable weights.

On the BCS Rankings page:
- **Left panel:** live Top 25, updates every time you hit Run. Movement arrows (▲▼ with numbers) show what changed vs the previous run.
- **Right panel:** all settings — weights, poll simulation, Elo, RPI/SOS blends.
- Rankings don't write to your save until you explicitly click **Write rankings to save**. Click **Don't update** to skip writing and move on without marking that step done.

---

## Bracket View

The Bracket View tab draws your bracket as a visual tree — seeds, team colors, all rounds — filling in as you apply each round. TBD for rounds not yet played.

- Read-only, never changes your save.
- Zoom slider available for screenshots or zoomed-in review.
- Load a different save to view a specific output file without disturbing what the rest of the tool is pointed at.
- The bracket size shown always matches your Format tab selection — switch formats if you loaded a save built for a different size.
- Once a champion is decided, a **Save Bracket** button appears.

---

## Bracket History

After a season ends and a champion is decided, click **Save Bracket** on the Bracket View tab to file it away by year. The History tab keeps a record of every saved season — pick a year from the dropdown to see the full bracket again.

This is stored in `bracketHistory.json` next to the .exe, separate from your save files. Saving the same year again replaces that year's entry.

The **All-Time Stats** tab (inside History) shows most championships, most playoff appearances, most playoff wins, and most championships as a coach — computed from everything you've saved to history.

---

## Changelog

### V3.0.0 (Current)

**New sidebar navigation** — replaced the two-layer app switcher + tab system with a persistent sidebar that shows all steps in order (Conferences → BCS Rankings → Bracket sub-steps → Tools). Active step highlighted in gold, completed steps show a checkmark.

**Dynamic progress guide** — the Conferences page now shows a live step-by-step guide that advances as you complete each step, replacing the old static "New here?" overview.

**Playoff folder backup** — Apply & Save and Write Rankings now overwrite your input save directly instead of prompting for an output location. A copy of the original is automatically saved to a `Playoff/` subfolder in your saves directory before anything is written.

**BCS Rankings redesign** — two-column layout with live Top 25 on the left (updates every Run) and all settings on the right. Movement indicators (▲▼ with numbers) show exactly how much each team moved vs the previous run. Rankings are not committed until you explicitly click Write or Don't Update.

**Championship venue picker** — pick from 20 confirmed premier neutral sites for the National Championship game. All venues confirmed against real save data.

**NY6/BCS matchup support for 2 and 4-team brackets** — dedicated "Apply BCS/NY6 Games Only" button lets you set the non-playoff NY6 game matchups in the correct bowl weeks, fully separate from the playoff bracket apply.

**Reseeding options** — for 16-team Round 2, choose between Reseed (best vs worst) or Bracket Order (1v16 winner vs 8v9 winner, 4v13 winner vs 5v12 winner, etc.). For 12-team Round 2, choose between CFP Convention or True Reseed. Setting appears before the file loader so you choose your style before checking results.

**Quarterfinal matchup preview** — both 12-team and 16-team Round 2 panels now show the QF matchup rows (with overridable dropdowns) between the winner confirmations and the Apply button.

**Performance improvements** — async file I/O throughout (eliminates "not responding" during Apply), conference detection and rankings compute in parallel on file load, debug logging removed.

**Bracket History All-Time Stats** — coach tracking now works correctly across saves.

**Team dropdowns sorted by rank** — all team pickers show ranked teams first with seed/record/conference labels.

**BCS/NY6 hint text reworded** — clearer instructions on when to run BCS matchups vs playoff games for each bracket size.

---



Post in the Discord with screenshots — especially the tool's own Log panel output alongside what actually happened in-game.
