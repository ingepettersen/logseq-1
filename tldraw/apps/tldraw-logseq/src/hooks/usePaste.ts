import {
  BoundsUtils,
  fileToBase64,
  getSizeFromSrc,
  TLAsset,
  TLBinding,
  TLShapeModel,
  uniqueId,
} from '@tldraw/core'
import type { TLReactCallbacks } from '@tldraw/react'
import * as React from 'react'
import type { Shape } from '~lib'

export function usePaste() {
  return React.useCallback<TLReactCallbacks<Shape>['onFileDrop']>(async (app, { point }) => {
    const assetId = uniqueId()
    interface ImageAsset extends TLAsset {
      size: number[]
    }

    const assetsToCreate: ImageAsset[] = []
    const shapesToCreate: TLShapeModel[] = []
    const bindingsToCreate: TLBinding[] = []

    async function handleImage(item: ClipboardItem) {
      const firstImageType = item.types.find(type => type.startsWith('image'))
      if (firstImageType) {
        const blob = await item.getType(firstImageType)
        const dataurl = await fileToBase64(blob)
        if (typeof dataurl !== 'string') return false
        const existingAsset = Object.values(app.assets).find(asset => asset.src === dataurl)
        if (existingAsset) {
          assetsToCreate.push(existingAsset as ImageAsset)
          return false
        }
        // Create a new asset for this image
        const asset: ImageAsset = {
          id: assetId,
          type: 'image',
          src: dataurl,
          size: await getSizeFromSrc(dataurl),
        }
        assetsToCreate.push(asset)
        return true
      }
      return false
    }

    async function handleLogseqShapes(item: ClipboardItem) {
      const plainTextType = item.types.find(type => type.startsWith('text/plain'))
      if (plainTextType) {
        const blob = await item.getType(plainTextType)
        const rawText = await blob.text()
        const data = JSON.parse(rawText)
        if (data.type === 'logseq/whiteboard-shapes') {
          const shapes = data.shapes as TLShapeModel[]
          const commonBounds = BoundsUtils.getCommonBounds(
            shapes.map(shape => ({
              minX: shape.point?.[0] ?? point[0],
              minY: shape.point?.[1] ?? point[1],
              width: shape.size?.[0] ?? 4,
              height: shape.size?.[1] ?? 4,
              maxX: (shape.point?.[0] ?? point[0]) + (shape.size?.[0] ?? 4),
              maxY: (shape.point?.[1] ?? point[1]) + (shape.size?.[1] ?? 4),
            }))
          )
          const clonedShapes = shapes.map((shape: TLShapeModel) => {
            return {
              ...shape,
              id: uniqueId(),
              parentId: app.currentPageId,
              point: [
                point[0] + shape.point![0] - commonBounds.minX,
                point[1] + shape.point![1] - commonBounds.minY,
              ],
            }
          })
          shapesToCreate.push(...clonedShapes)

          // Try to rebinding the shapes to the new assets
          shapesToCreate.forEach((s, idx) => {
            if (s.handles) {
              Object.values(s.handles).forEach(h => {
                if (h.bindingId) {
                  // try to bind the new shape
                  const binding = app.currentPage.bindings[h.bindingId]
                  // if the copied binding from/to is in the source
                  const oldFromIdx = shapes.findIndex(s => s.id === binding.fromId)
                  const oldToIdx = shapes.findIndex(s => s.id === binding.toId)
                  if (binding && oldFromIdx !== -1 && oldToIdx !== -1) {
                    const newBinding: TLBinding = {
                      ...binding,
                      id: uniqueId(),
                      fromId: shapesToCreate[oldFromIdx].id,
                      toId: shapesToCreate[oldToIdx].id,
                    }
                    bindingsToCreate.push(newBinding)
                    h.bindingId = newBinding.id
                  } else {
                    h.bindingId = undefined
                  }
                }
              })
            }
          })
        }
      }
    }

    // TODO: supporting other pasting formats
    for (const item of await navigator.clipboard.read()) {
      try {
        let handled = await handleImage(item)
        if (!handled) {
          await handleLogseqShapes(item)
        }
      } catch (error) {
        console.error(error)
      }
    }

    const allShapesToAdd: TLShapeModel[] = [
      ...assetsToCreate.map((asset, i) => ({
        id: uniqueId(),
        type: 'image',
        parentId: app.currentPageId,
        point: [point[0] - asset.size[0] / 2 + i * 16, point[1] - asset.size[1] / 2 + i * 16],
        size: asset.size,
        assetId: asset.id,
        opacity: 1,
      })),
      ...shapesToCreate,
    ]
    app.createAssets(assetsToCreate)
    app.createShapes(allShapesToAdd)
    app.currentPage.updateBindings(Object.fromEntries(bindingsToCreate.map(b => [b.id, b])))

    app.setSelectedShapes(allShapesToAdd.map(s => s.id))
  }, [])
}