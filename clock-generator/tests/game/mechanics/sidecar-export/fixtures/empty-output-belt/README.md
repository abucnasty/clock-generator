# Empty output belt

`scaffold.scaffold` holds one assembling machine 3 making iron gear wheels, fed from an infinity chest. Three fast
inserters take from it. Each is held by a circuit condition (anything > 0) on one red wire that carries no signal, so
none swings and every output belt is empty:

- north: a drop onto the first belt of a straight line that runs west;
- east: a drop onto an underground exit from its side (the exit runs south);
- south: a drop onto a side belt (the drop tile, then a curve) that side-loads onto a belt that runs east and is fed
  from behind.

Every belt ends in a dead end. `../../empty-output-belt.game.test.ts` exports the build while the inserters are held,
then cuts the wire, lets the build run and exports it again: the two exports must be equal. It also holds the line
that each first drop lands on against the line the export reads for it. Built with factorio-draftsman 4.0.1 on the
data of Factorio 2.1.24.
