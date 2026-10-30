const owner = process.env.BOUNDARY_VISION_GITHUB_OWNER?.trim()
const repo = process.env.BOUNDARY_VISION_GITHUB_REPO?.trim()
const build = require('./package.json').build

if (Boolean(owner) !== Boolean(repo)) {
  throw new Error('Set both BOUNDARY_VISION_GITHUB_OWNER and BOUNDARY_VISION_GITHUB_REPO for a GitHub Releases build.')
}

if (owner && (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo))) {
  throw new Error('The configured GitHub owner or repository name is invalid.')
}

module.exports = {
  ...build,
  ...(owner ? { publish: [{ provider: 'github', owner, repo, releaseType: 'draft' }] } : {}),
}
