// TODO:
// testCase({ inclusive: false, paths: [] }, [], false);
// testCase({ inclusive: false, paths: [] }, ['lol'], true);
// testCase({ inclusive: true, paths: ['hello'] }, ['hello.world'], true);
// testCase({ inclusive: true, paths: ['hello.world'] }, ['hello.world'], true);
// testCase({ inclusive: true, paths: ['hello.world'] }, ['hello.lol'], false);
// testCase({ inclusive: true, paths: ['hello.world'] }, ['hello'], true);
// testCase({ inclusive: true, paths: ['hello', 'lol'] }, ['lol'], true);
// testCase({ inclusive: true, paths: ['hello', 'lol'] }, ['nah'], false);
// testCase({ inclusive: false, paths: ['hello'] }, ['hello.world'], false);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello.world'], false);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello.lol'], true);
// testCase({ inclusive: false, paths: ['hello', 'lol'] }, ['hello', 'lol'], false);
// testCase({ inclusive: false, paths: ['hello', 'lol'] }, ['hello', 'lol', 'cool'], true);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello'], true);
// testCase({ inclusive: false, paths: ['hello.world'] }, ['hello.world.ok'], false);
