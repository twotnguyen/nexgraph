// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchBar } from '../components/layout/WorkbenchBar'
import { currentTheme, initializeTheme } from './useTheme'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  localStorage.removeItem('nexgraph.theme')
})

it('applies the saved theme at startup and stores the next setting from the workbench', async () => {
  localStorage.setItem('nexgraph.theme', 'dark')
  initializeTheme()
  render(<WorkbenchBar />)
  expect(document.documentElement.dataset.theme).toBe('dark')
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' }))
  await screen.findByRole('button', { name: 'Chuyển sang giao diện tối' })
  expect(localStorage.getItem('nexgraph.theme')).toBe('light')
  document.documentElement.removeAttribute('data-theme')
  initializeTheme()
  expect(currentTheme()).toBe('light')
})
