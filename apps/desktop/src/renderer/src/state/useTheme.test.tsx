// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { WorkbenchBar } from '../components/layout/WorkbenchBar'
import { currentTheme, initializeTheme } from './useTheme'
import { installKeymap } from './commands'

beforeAll(() => installKeymap())

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-appearance')
  localStorage.removeItem('nexgraph.theme')
})

it('applies the saved theme at startup and stores the theme picked in the workbench', async () => {
  localStorage.setItem('nexgraph.theme', 'dark')
  initializeTheme()
  render(<WorkbenchBar />)
  expect(currentTheme()).toBe('dark')
  await userEvent.click(screen.getByRole('button', { name: 'Giao diện: NexGraph Tối' }))
  await userEvent.click(screen.getByRole('option', { name: /Catppuccin Latte/ }))
  expect(screen.queryByRole('dialog', { name: 'Chọn chủ đề màu' })).not.toBeInTheDocument()
  expect(localStorage.getItem('nexgraph.theme')).toBe('catppuccin-latte')
  expect(document.documentElement.dataset.theme).toBe('catppuccin-latte')
  expect(currentTheme()).toBe('light')
  localStorage.setItem('nexgraph.theme', 'removed-theme')
  initializeTheme()
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('previews while moving through the list and Escape restores the saved theme', async () => {
  localStorage.setItem('nexgraph.theme', 'wu-dark')
  initializeTheme()
  render(<WorkbenchBar />)
  await userEvent.click(screen.getByRole('button', { name: 'Giao diện: Wu Dark' }))
  const search = screen.getByRole('combobox', { name: 'Chọn chủ đề màu' })
  await userEvent.type(search, 'one')
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['One DarkTối', 'One LightSáng'])
  expect(document.documentElement.dataset.theme).toBe('one-dark')
  await userEvent.keyboard('{ArrowDown}')
  expect(document.documentElement.dataset.theme).toBe('one-light')
  await userEvent.keyboard('{Escape}')
  expect(document.documentElement.dataset.theme).toBe('wu-dark')
  expect(localStorage.getItem('nexgraph.theme')).toBe('wu-dark')
})
