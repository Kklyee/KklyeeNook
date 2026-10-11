import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { SkillLoader } from './skillLoader'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = join(tmpdir(), `kklyeenook-skills-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(directory, { recursive: true })
  temporaryDirectories.push(directory)
  return directory
}

test('loads skill metadata and instructions while ignoring unknown frontmatter', async () => {
  const root = await createTemporaryDirectory()
  await mkdir(join(root, 'code-review'))
  await mkdir(join(root, 'without-skill-file'))
  await writeFile(
    join(root, 'code-review', 'SKILL.md'),
    `---\nname: Code Review\ndescription: Review changes carefully\nmaintainer: local\n---\n\nRead the changed files before replying.\n`,
  )

  const loader = new SkillLoader(root)
  await expect(loader.reload()).resolves.toEqual([
    {
      id: 'code-review',
      name: 'Code Review',
      description: 'Review changes carefully',
      instructions: 'Read the changed files before replying.',
      directory: join(root, 'code-review'),
    },
  ])
  expect(loader.getSkill('code-review')?.instructions).toBe('Read the changed files before replying.')
})

test('keeps the backend loadable when the directory is missing or a skill is malformed', async () => {
  const root = await createTemporaryDirectory()
  const warn = vi.fn()
  const loader = new SkillLoader(join(root, 'missing'), { warn })

  await expect(loader.reload()).resolves.toEqual([])

  await mkdir(join(root, 'broken'))
  await writeFile(join(root, 'broken', 'SKILL.md'), '---\nname: [broken\n---\nbody')
  await mkdir(join(root, 'research'))
  await writeFile(join(root, 'research', 'SKILL.md'), '---\nname: Research\ndescription: Find sources\n---\nUse sources.\n')
  const reloaded = new SkillLoader(root, { warn })

  await expect(reloaded.reload()).resolves.toEqual([
    expect.objectContaining({ id: 'research', name: 'Research' }),
  ])
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping skill'))
})

test('removes deleted skills after reload', async () => {
  const root = await createTemporaryDirectory()
  const directory = join(root, 'research')
  await mkdir(directory)
  await writeFile(join(directory, 'SKILL.md'), '---\nname: Research\n---\nUse sources.\n')
  const loader = new SkillLoader(root)

  await loader.reload()
  await rm(directory, { recursive: true })
  await expect(loader.reload()).resolves.toEqual([])
  expect(loader.listSkills()).toEqual([])
})
