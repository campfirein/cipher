import {expect} from 'chai'

import {sanitizeFolderName, toSnakeCase} from '../../../src/server/utils/file-helpers.js'

describe('file-helpers', () => {
  describe('sanitizeFolderName()', () => {
    it('should sanitize folder name with spaces', () => {
      expect(sanitizeFolderName('Use Case Analysis')).to.equal('Use-Case-Analysis')
      expect(sanitizeFolderName('Use Case Analysis_txt')).to.equal('Use-Case-Analysis_txt')
    })

    it('should preserve allowed characters (letters, numbers, underscore, hyphen, dot, slash)', () => {
      expect(sanitizeFolderName('folder_name-123')).to.equal('folder_name-123')
      expect(sanitizeFolderName('test.folder')).to.equal('test.folder')
      expect(sanitizeFolderName('path/to/folder')).to.equal('path/to/folder')
      expect(sanitizeFolderName('my-folder_123.txt')).to.equal('my-folder_123.txt')
    })

    it('should replace special characters with hyphen', () => {
      expect(sanitizeFolderName('folder@name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder#name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder$name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder%name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder&name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder*name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder+name')).to.equal('folder-name')
      expect(sanitizeFolderName('folder=name')).to.equal('folder-name')
    })

    it('should handle multiple consecutive special characters', () => {
      expect(sanitizeFolderName('folder@@@name')).to.equal('folder---name')
      expect(sanitizeFolderName('folder   name')).to.equal('folder---name')
      expect(sanitizeFolderName('folder!!!name')).to.equal('folder---name')
    })

    it('should handle leading and trailing special characters', () => {
      expect(sanitizeFolderName('@folder')).to.equal('-folder')
      expect(sanitizeFolderName('folder@')).to.equal('folder-')
      expect(sanitizeFolderName('@folder@')).to.equal('-folder-')
      expect(sanitizeFolderName('  folder  ')).to.equal('--folder--')
    })

    it('should preserve forward slashes in paths', () => {
      expect(sanitizeFolderName('path/to/folder')).to.equal('path/to/folder')
      expect(sanitizeFolderName('path/to/my folder')).to.equal('path/to/my-folder')
      expect(sanitizeFolderName('path/to/folder@name')).to.equal('path/to/folder-name')
    })

    it('should preserve dots in filenames', () => {
      expect(sanitizeFolderName('folder.name')).to.equal('folder.name')
      expect(sanitizeFolderName('my.folder.name')).to.equal('my.folder.name')
      expect(sanitizeFolderName('folder.name@test')).to.equal('folder.name-test')
    })

    it('should handle empty string', () => {
      expect(sanitizeFolderName('')).to.equal('')
    })

    it('should handle string with only special characters', () => {
      expect(sanitizeFolderName('@@@')).to.equal('---')
      expect(sanitizeFolderName('   ')).to.equal('---')
      expect(sanitizeFolderName('!!!')).to.equal('---')
    })

    it('should handle unicode and emoji characters', () => {
      expect(sanitizeFolderName('folder🚀name')).to.equal('folder--name')
      expect(sanitizeFolderName('folder中文name')).to.equal('folder--name')
      expect(sanitizeFolderName('café-folder')).to.equal('caf--folder')
    })

    it('should handle brackets and parentheses', () => {
      expect(sanitizeFolderName('folder(name)')).to.equal('folder-name-')
      expect(sanitizeFolderName('folder[name]')).to.equal('folder-name-')
      expect(sanitizeFolderName('folder{name}')).to.equal('folder-name-')
    })

    it('should handle complex mixed scenarios', () => {
      expect(sanitizeFolderName('My Project (v1.0) - Final!')).to.equal('My-Project--v1.0----Final-')
      expect(sanitizeFolderName('path/to/my project@2024')).to.equal('path/to/my-project-2024')
      expect(sanitizeFolderName('test.folder_name-123')).to.equal('test.folder_name-123')
    })

    it('should not modify already sanitized names', () => {
      expect(sanitizeFolderName('valid-folder_name')).to.equal('valid-folder_name')
      expect(sanitizeFolderName('path/to/valid.folder')).to.equal('path/to/valid.folder')
      expect(sanitizeFolderName('123_folder-456')).to.equal('123_folder-456')
    })
  })

  describe('toSnakeCase()', () => {
    it('should convert spaces to underscores and lowercase', () => {
      expect(toSnakeCase('Best Practices')).to.equal('best_practices')
      expect(toSnakeCase('Error Handling')).to.equal('error_handling')
    })

    it('should convert hyphens to underscores', () => {
      expect(toSnakeCase('error-handling')).to.equal('error_handling')
      expect(toSnakeCase('Best-Practices')).to.equal('best_practices')
    })

    it('should handle mixed case and convert to lowercase', () => {
      expect(toSnakeCase('QuickSort Optimizations')).to.equal('quicksort_optimizations')
      expect(toSnakeCase('MyTopic')).to.equal('mytopic')
      expect(toSnakeCase('CamelCase')).to.equal('camelcase')
    })

    it('should collapse multiple underscores', () => {
      expect(toSnakeCase('too   many   spaces')).to.equal('too_many_spaces')
      expect(toSnakeCase('too---many---hyphens')).to.equal('too_many_hyphens')
      expect(toSnakeCase('mixed   ---   chars')).to.equal('mixed_chars')
    })

    it('should remove leading and trailing underscores', () => {
      expect(toSnakeCase(' leading space')).to.equal('leading_space')
      expect(toSnakeCase('trailing space ')).to.equal('trailing_space')
      expect(toSnakeCase('  both sides  ')).to.equal('both_sides')
    })

    it('should handle empty string', () => {
      expect(toSnakeCase('')).to.equal('')
    })

    it('should handle special characters', () => {
      expect(toSnakeCase('test@topic#name')).to.equal('test_topic_name')
      expect(toSnakeCase('topic (v1.0)')).to.equal('topic_v1_0')
      expect(toSnakeCase('file!name?here')).to.equal('file_name_here')
    })

    it('should handle already snake_case strings', () => {
      expect(toSnakeCase('already_snake_case')).to.equal('already_snake_case')
      expect(toSnakeCase('simple_name')).to.equal('simple_name')
    })

    it('should handle strings with numbers', () => {
      expect(toSnakeCase('version 2.0')).to.equal('version_2_0')
      expect(toSnakeCase('test123name')).to.equal('test123name')
      expect(toSnakeCase('123 start with number')).to.equal('123_start_with_number')
    })

    it('should handle complex mixed scenarios', () => {
      expect(toSnakeCase('My Project (v1.0) - Final!')).to.equal('my_project_v1_0_final')
      expect(toSnakeCase('API Response Handler')).to.equal('api_response_handler')
      expect(toSnakeCase('user-input_validation')).to.equal('user_input_validation')
    })
  })
})
