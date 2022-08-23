import { get as getStore } from 'svelte/store'
import * as wn from 'webnative'
import { filesystemStore, galleryStore } from '../stores'
import { convertUint8ToString, uuid } from '$lib/common/utils'

export enum AREAS {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
}

export type Image = {
  id: string
  mtime: number
  name: string
  private: boolean
  size: number
  src: string
}

export type Gallery = {
  publicImages: Image[] | null
  privateImages: Image[] | null
  selectedArea: AREAS
  loading: boolean
}

const GALLERY_DIRS = {
  [AREAS.PUBLIC]: ['public', 'gallery'],
  [AREAS.PRIVATE]: ['private', 'gallery'],
}
const FILE_SIZE_LIMIT = 5

/**
 * Get images from the user's WNFS and construct the `src` value for the images
 */
export const getImagesFromWNFS: () => Promise<void> = async () => {
  try {
    // Set loading: true on the galleryStore
    galleryStore.update((store) => ({ ...store, loading: true }))

    const { selectedArea } = getStore(galleryStore)
    const isPrivate = selectedArea === AREAS.PRIVATE
    const fs = getStore(filesystemStore)

    // Set path to either private or public gallery dir
    const path = wn.path.directory(...GALLERY_DIRS[selectedArea])

    // Get list of links for files in the gallery dir
    const links = await fs.ls(path)

    console.log('links', links)

    const images = await Promise.all(
      Object.entries(links).map(async ([name, _]) => {
        const file = await fs.get(
          wn.path.file(...GALLERY_DIRS[selectedArea], `${name}`)
        )
        console.log('file', file)

        const src = `data:image/jpeg;base64, ${btoa(
          convertUint8ToString(file.content as Uint8Array)
        )}`

        return {
          id: uuid(),
          mtime: file.header.metadata.unixMeta.mtime,
          name,
          private: isPrivate,
          size: links[name].size,
          src,
        }
      })
    )

    // Sort images by mtime(modified date)
    // NOTE: this will eventually be controlled via the UI
    images.sort((a, b) => b.mtime - a.mtime)

    console.log('images', images)

    // Push images to the galleryStore
    galleryStore.update((store) => ({
      ...store,
      ...(isPrivate ? {
        privateImages: images,
      } : {
        publicImages: images,
      }),
      loading: false,
    }))
  } catch (error) {
    console.error(error)
    galleryStore.update(store => ({
      ...store,
      loading: false,
    }))
  }
}

/**
 * Upload an image to the user's private or public WNFS
 * @param image
 */
export const uploadImageToWNFS: (
  image: File
) => Promise<void> = async image => {
  try {
    const { selectedArea } = getStore(galleryStore)
    const fs = getStore(filesystemStore)
    console.log('image', image)
    // Reject files over 5MB
    const imageSizeInMB = image.size / (1024 * 1024)
    if (imageSizeInMB > FILE_SIZE_LIMIT) {
      throw new Error('Image can be no larger than 5MB')
    }

    // Check if image already exists in the gallery dir
    const imageExists = await fs.exists(
      wn.path.file(...GALLERY_DIRS[selectedArea], image.name)
    )

    if (!imageExists) {
      // Create a sub directory and add some content
      await fs.write(
        wn.path.file(...GALLERY_DIRS[selectedArea], image.name),
        image
      )

      // Announce the changes to the server
      await fs.publish()

      // TODO: replace with Toast notification once they've been added to the app
      console.log(`${image.name} image has been published`)
    } else {
      throw new Error(`${image.name} image alread exists`)
    }
  } catch (error) {
    console.log(error)
  }
}

/**
 * Delete an image from the user's private or public WNFS
 * @param name
 */
export const deleteImageFromWNFS: (name: string) => Promise<void> = async (name) => {
  try {
    const { selectedArea } = getStore(galleryStore)
    const fs = getStore(filesystemStore)

    const imageExists = await fs.exists(
      wn.path.file(...GALLERY_DIRS[selectedArea], name)
    )

    if (imageExists) {
      // Remove images from server
      await fs.rm(wn.path.file(...GALLERY_DIRS[selectedArea], name))

      // Announce the changes to the server
      await fs.publish()

      // TODO: replace with Toast notification once they've been added to the app
      console.log(`${name} image has been deleted`)

      // Refetch images and update galleryStore
      await getImagesFromWNFS()
    } else {
      throw new Error(`${name} image has already been deleted`)
      // TODO: add Toast notification once they've been added to the app
    }
  } catch (error) {
    console.error(error)
  }
}

/**
 * Handle uploads made by interacting with the file input directly
 */
export const handleFileInput: (
  files: FileList
) => Promise<void> = async files => {
  await Promise.all(
    Array.from(files).map(async file => {
      await uploadImageToWNFS(file)
    })
  )

  // Refetch images and update galleryStore
  await getImagesFromWNFS()
}