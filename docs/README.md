# Documentation

The clock generator's documentation, in two DITA maps:

- [`user/user.ditamap`](user/user.ditamap): for users, who make clocks for their builds.
- [`maintainer/maintainer.ditamap`](maintainer/maintainer.ditamap): for maintainers and agents, who change the generator,
  the site or the sidecar.

A topic that both maps need goes in `shared/`, and both maps link to it.

## Topics

Each topic is a Markdown file in MDITA, the Markdown form of Lightweight DITA. Its YAML front matter gives its type with
`$schema` (`concept`, `task` or `reference`) and its `id`. The files render on GitHub, and DITA-OT can build them into
HTML or PDF.

- A **concept** tells what something is and how it works.
- A **task** tells how to do one procedure: *Before you start*, *Procedure* (numbered steps, one instruction each,
  the result after the step) and *Result*.
- A **reference** gives facts to look up, mostly in tables.

## Language

Topics are written in ASD-STE100 Simplified Technical English: approved words with their approved meanings, technical
nouns and technical verbs, short sentences (20 words in a procedure, 25 in a description) and the active voice.

The words of the clock generator, and the words they replace, are in the [glossary](maintainer/glossary.md). Use its
terms only. The user guide does not use the terms that the glossary marks for maintainers.

Labels on the screen are in bold, exactly as the site, the sidecar or the game shows them: **Paste from Factorio**,
**Export**, **Enable if**.
