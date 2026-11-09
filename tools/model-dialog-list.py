#!/usr/bin/env python3
"""An independent model of the list rules of CKTDGUIDialogManager, written from the decompile of x2.exe (not from the TypeScript port):
_InsertIntoDialogListTop 328E1010, _RemoveFromDialogList 328E1180, ChangeFront 328DDBE0, ChangeLayer 328DDC90, both ChangeSequence
(328DDF20, and the pivot overload 328DDD40) and the wrap of m_iDialogListChangeCount above 2147483637.

    python3 tools/model-dialog-list.py

The expected numbers of packages/ui/test/dialogmanager.test.ts (the order of the dialogs, the manager's count of changes and the count each
dialog took) were worked out by hand and then checked against the output of the scenarios below, each of which is the sequence of a test.
The list runs from the back of the screen to the front.  Only the list is modelled: the set, the walks that stand on a dialog and the count of
modal dialogs are not (the tests pin those by hand).
"""
import json

LIM = 2147483637  # m_iDialogListChangeCount goes back to 1 above this


class D:
    def __init__(s, name, front=False, layer=0):
        s.name, s.front, s.layer, s.count = name, front, layer, 0


class M:
    def __init__(s):
        s.lst, s.cc = [], 0

    def bump(s):
        s.cc += 1
        if s.cc > LIM:
            s.cc = 1
        return s.cc

    def names(s):
        return [d.name for d in s.lst]

    def insert_top(s, d):
        """before the first dialog that is front while d is not, or that has d's front flag and a layer above d's"""
        i = 0
        while i < len(s.lst):
            n = s.lst[i]
            if (not d.front and n.front) or (d.front == n.front and d.layer < n.layer):
                break
            i += 1
        s.lst.insert(i, d)
        d.count = s.bump()

    def remove(s, d):
        if d not in s.lst:
            return False
        s.lst.remove(d)
        s.bump()
        d.count = 0
        return True

    def add(s, d):
        s.insert_top(d)

    def change_front(s, d, v):
        if d.front != v:
            s.remove(d)
            d.front = v
            s.insert_top(d)

    def change_layer(s, d, v):
        if d.layer != v:
            s.remove(d)
            d.layer = v
            s.insert_top(d)

    def seq(s, d, top):
        """ChangeSequence(d, top): a dialog that made the last change and is where it is asked to be stays"""
        if abs(d.count) == s.cc and ((top and d.count > 0) or (not top and d.count < 0)):
            return 'shortcut'
        s.remove(d)
        if top:
            s.insert_top(d)
            return 'top'
        i = 0
        while i < len(s.lst):
            n = s.lst[i]
            if (not d.front and n.front) or (d.front == n.front and d.layer <= n.layer):
                break
            i += 1
        s.lst.insert(i, d)
        d.count = -s.bump()
        return 'bottom'

    def pivot(s, d, p, over, change_layer):
        """ChangeSequence(d, pivot, bOver, bChangeLayer): next to the pivot, taking its front flag and layer"""
        if d is p:
            return False
        if not change_layer and (d.front != p.front or d.layer != p.layer):
            return False
        s.remove(d)
        d.front, d.layer = p.front, p.layer
        if p not in s.lst:
            return False
        i = s.lst.index(p) + (1 if over else 0)
        s.lst.insert(i, d)
        d.count = s.bump()
        return True

    def show(s, label):
        print(f"{label:38s} {s.names()} cc={s.cc} counts={ {d.name: d.count for d in s.lst} }")


def rec(m, label, r=None):
    print(f"  [{json.dumps(m.names())}, {m.cc}, {json.dumps([d.count for d in m.lst])}], // {label}{' ' + str(r) if r else ''}")


def main():
    print("S1: eight dialogs added one after the other (back / front, layers)")
    m = M()
    for n, f, l in [("A", 0, 5), ("B", 0, 3), ("C", 0, 5), ("D", 1, 0), ("E", 0, 4), ("F", 1, -1), ("G", 1, 0), ("H", 0, 9)]:
        m.add(D(n, bool(f), l))
        m.show("add " + n)

    print("S2: ChangeLayer / ChangeFront")
    m = M()
    P, Q, R, S = D("P", False, 1), D("Q", False, 2), D("R", False, 2), D("S", True, 0)
    for d in (P, Q, R, S):
        m.add(d)
    m.show("init")
    m.change_layer(Q, 2)
    m.show("changeLayer(Q,2) no-op")
    m.change_layer(P, 2)
    m.show("changeLayer(P,2)")
    m.change_front(Q, True)
    m.show("changeFront(Q,true)")
    m.change_front(S, True)
    m.show("changeFront(S,true) no-op")
    m.change_front(S, False)
    m.show("changeFront(S,false)")

    print("S3: ChangeSequence to the top and to the bottom")
    m = M()
    A, B, C, Dd, E = D("A", False, 0), D("B", False, 0), D("C", False, 0), D("D", False, 1), D("E", True, 0)
    for d in (A, B, C, Dd, E):
        m.add(d)
    rec(m, "init")
    for label, d, top in [("seq(E,true): the last change, already on top", E, True), ("seq(A,true)", A, True), ("seq(A,true) again", A, True),
                          ("seq(A,false)", A, False), ("seq(A,false) again", A, False), ("seq(A,true)", A, True), ("seq(E,false)", E, False)]:
        r = m.seq(d, top)
        rec(m, label, r)
    F = D("F", True, 0)
    m.add(F)
    rec(m, "add F(T,0)")
    r = m.seq(E, False)
    rec(m, "seq(E,false) after another change", r)
    r = m.seq(F, False)
    rec(m, "seq(F,false)", r)
    X = D("X", False, 1)
    m.add(X)
    rec(m, "add X(F,1)")
    r = m.seq(X, False)
    rec(m, "seq(X,false)", r)
    r = m.seq(X, True)
    rec(m, "seq(X,true)", r)
    r = m.seq(Dd, False)
    rec(m, "seq(D,false)", r)

    print("S4: ChangeSequence with a pivot")
    m = M()
    P, Q, R, S = D("P", False, 1), D("Q", False, 1), D("R", False, 2), D("S", True, 1)
    for d in (P, Q, R, S):
        m.add(d)
    m.show("init")
    print(m.pivot(P, R, True, False))
    m.show("pivot(P,R,over,!chg) layer differs")
    print(m.pivot(R, S, True, False))
    m.show("pivot(R,S,over,!chg) front differs")
    print(m.pivot(P, S, True, False))
    m.show("pivot(P,S,over,!chg) front differs, same layer")
    print(m.pivot(S, Q, False, False))
    m.show("pivot(S,Q,before,!chg) front differs, same layer")
    print(m.pivot(P, P, True, True))
    m.show("pivot(P,P)")
    print(m.pivot(P, Q, False, False))
    m.show("pivot(P,Q,before,!chg)")
    print(m.pivot(P, Q, True, False))
    m.show("pivot(P,Q,over,!chg)")
    print(m.pivot(S, P, False, True), S.front, S.layer)
    m.show("pivot(S,P,before,chg)")
    print(m.pivot(R, Q, True, True), R.front, R.layer)
    m.show("pivot(R,Q,over,chg)")

    print("wrap of the count of changes")
    m = M()
    m.cc = LIM - 1
    x = D("x")
    m.add(x)
    print(m.cc, x.count)
    y = D("y")
    m.add(y)
    print(m.cc, y.count)
    m = M()
    m.cc = LIM
    x = D("x")
    m.add(x)
    print("from LIM:", m.cc, x.count)
    m = M()
    x = D("x")
    m.add(x)
    m.cc = LIM
    print(m.remove(x), m.cc, x.count)
    m = M()
    x = D("x")
    m.add(x)
    m.cc = LIM - 1
    print(m.remove(x), m.cc, x.count)


if __name__ == '__main__':
    main()
