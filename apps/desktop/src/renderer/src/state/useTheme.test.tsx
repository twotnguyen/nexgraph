// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchBar } from '../components/layout/WorkbenchBar'
import { currentTheme, initializeTheme } from './useTheme'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-appearance')
  localStorage.removeItem('nexgraph.theme')
})

it('applies the saved theme at startup and stores the theme picked in the workbench', () => {
  localStorage.setItem('nexgraph.theme', 'dark')
  initializeTheme()
  render(<WorkbenchBar />)
  expect(currentTheme()).toBe('dark')
  fireEvent.change(screen.getByRole('combobox', { name: 'Giao diện' }), { target: { value: 'catppuccin-latte' } })
  expect(localStorage.getItem('nexgraph.theme')).toBe('catppuccin-latte')
  expect(document.documentElement.dataset.theme).toBe('catppuccin-latte')
  expect(currentTheme()).toBe('light')
  localStorage.setItem('nexgraph.theme', 'removed-theme')
  initializeTheme()
  expect(document.documentElement.dataset.theme).toBe('light')
})
