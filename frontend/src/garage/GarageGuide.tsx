import { HelpNote } from '../components/HelpNote'

export function GarageGuide() {
  return (
    <HelpNote title="What is the garage? What do all these numbers mean?" open>
      <p>
        <b>The question:</b> your team has limited money. Which upgrade to the car&apos;s warning system (if any) keeps the car on
        track under the stress scenarios, without spending cash you need for the rest of the season?
      </p>
      <ol>
        <li>
          <b>Money boxes (top).</b> Cash on hand minus the cost of remaining events minus a safety reserve gives{' '}
          <b>Available for upgrades</b>. You can only select upgrades that fit inside it. All numbers are editable made-up demo values.
        </li>
        <li>
          <b>Upgrade cards.</b> <i>Brake servicing</i> restores worn brakes. <i>Communication improvement</i> cuts network delay and
          loss (it cannot fix a full blackout). <i>Local warning fallback</i> lets the car warn itself from its own sensors when the
          remote warning goes stale. Each card states exactly what it changes in the simulator.
        </li>
        <li>
          <b>Run fixed evaluation suite.</b> Simulates <i>every</i> combination of upgrades (8) on a fixed set of stress tests the app never
          tuned against, on the same seeds. A configuration <b>passes</b> only if there are 0 track exits, the lap/test completes, and the
          car never gets closer than 0.5 m to leaving the track.
        </li>
        <li>
          <b>Suite tabs</b> choose which group of tests you are judged on (all, telemetry problems, sensor faults, grip and brakes).
          &quot;Full stress suite: 0 of 8 pass&quot; means no upgrade combination survives <i>everything</i>, which is a legitimate result.
        </li>
        <li>
          <b>Results table.</b> Cost, track exits, lowest clearance to the edge, smallest warning margin (metres of braking room left when the
          warning appeared) and unnecessary warnings (false alarms). <b>Why Baseline did not pass</b> lists each failed test and where the car left.
        </li>
        <li>
          <b>Controlled comparison.</b> Pick one scenario and rerun it clean, with fault A only, B only, both, and both plus your upgrade, all
          with identical seed and start, so you can see what each fault and each upgrade really does.
        </li>
        <li><b>Compare baseline vs selected</b> replays a failing test side by side; <b>Drive this configuration</b> lets you drive the car with the upgrade applied.</li>
      </ol>
    </HelpNote>
  )
}
