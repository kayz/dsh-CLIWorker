function deadHelper() {
  return 1
}

async function deadAsync() {
  return 2
}

function* deadGen() {
  yield 3
}

function deadRecursive(n) {
  return deadRecursive(n - 1)
}

function liveHelper() {
  return 4
}

export function exportedUnused() {
  return liveHelper()
}
